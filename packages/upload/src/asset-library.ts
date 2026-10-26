import { log } from '@vitrin/core';
import { AssetLibraryDisplayClassEnum, type AscDisplayTypesFile, type AssetLibraryCategory, type AssetLibraryDisplayClass, type AssetLibraryPlacementType, type AssetLibraryPlatform } from '@vitrin/schemas';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AscClient, JsonApiDocument, JsonApiResource } from './asc-client.js';
import { loadAscDisplayTypes } from './display-types.js';
import { defaultSleep, performUploadOperations, type PollOptions, type UploadOperation } from './upload-operations.js';

export type { UploadOperation } from './upload-operations.js';

/**
 * App Asset Library client, written against the App Store Connect API 4.5.1 OpenAPI spec:
 * - AppAssetLibraryImageCreateRequest / AppAssetLibraryVideoCreateRequest: `fileName`, `fileSize` and `category`
 *   (CREATIVE_ASSETS | APP_SCREENSHOTS_AND_PREVIEWS) are required, plus the `assetLibrary` relationship; videos may
 *   carry `previewFrameTimeCode`.
 * - Commit: AppAssetLibrary{Image,Video}UpdateRequest `{ uploaded: true }` — unlike appScreenshots there is no
 *   `sourceFileChecksum` attribute. Processing is reported in the top-level `state` (AppAssetLibraryAssetState).
 * - AppAssetLibraryPlacementCreateRequest: attributes `placementType` (required) and `placementGroup`; relationships
 *   `image` or `video` plus exactly one owner localization. There is no `displayClass` attribute: the placement group
 *   id comes from GET /v1/appAssetLibraryRefData `placementProfileGroups[]` ({ placementProfileGroupId, platform,
 *   displayClassId }).
 * - AppAssetLibraryPlacementOrderingRequestCreateRequest: `placementGroup` + `orderedPlacements` + the owner
 *   localization (version, custom product page or experiment treatment — not In-App Events).
 * - GET /v1/{owner}/{id}/placements supports filter[placementType] and filter[placementGroup].
 * The flow mirrors rorkai/App-Store-Connect-CLI (MIT; internal/asc/asset_library_upload.go,
 * internal/cli/shared/creative_placement_*.go), which also documents `DEFAULT_PROFILE` as the group of header,
 * search and event creatives.
 *
 * Vitrin uses this only for what the classic appScreenshotSets/appPreviewSets API cannot do (iPhone Duo, product
 * page header and search creatives, event assets), or for all media with `upload.uploader: asset-library`.
 */

export type AssetKind = 'image' | 'video';
export type OwnerType = 'appStoreVersionLocalizations' | 'appCustomProductPageLocalizations' | 'appEventLocalizations' | 'appStoreVersionExperimentTreatmentLocalizations';
export interface Owner {
  type: OwnerType;
  id: string;
}

export interface PlacementSpec {
  placementType: AssetLibraryPlacementType;
  displayClass: AssetLibraryDisplayClass;
  platform: AssetLibraryPlatform;
  category: AssetLibraryCategory;
}

/** Relationship name of each owner type in placement and ordering requests. */
export const OWNER_RELATIONSHIP: Record<OwnerType, string> = {
  appStoreVersionLocalizations: 'appStoreVersionLocalization',
  appCustomProductPageLocalizations: 'appCustomProductPageLocalization',
  appEventLocalizations: 'appEventLocalization',
  appStoreVersionExperimentTreatmentLocalizations: 'appStoreVersionExperimentTreatmentLocalization',
};

/** Header, search and event creatives: rorkai/App-Store-Connect-CLI sends this group for them (live-verified there). */
export const DEFAULT_CREATIVE_GROUP = 'DEFAULT_PROFILE';
const NATIVE_PLACEMENTS = new Set<AssetLibraryPlacementType>(['APP_SCREENSHOT', 'IMESSAGE_APP_SCREENSHOT', 'APP_PREVIEW']);

// ---- request bodies (pure, tested against the spec's required fields) ----

export function assetCreateBody(kind: AssetKind, libraryId: string, a: { fileName: string; fileSize: number; category: AssetLibraryCategory; referenceName?: string; previewFrameTimeCode?: string }) {
  const type = kind === 'image' ? 'appAssetLibraryImages' : 'appAssetLibraryVideos';
  return {
    data: {
      type,
      attributes: {
        fileName: a.fileName,
        fileSize: a.fileSize,
        category: a.category,
        ...(a.referenceName ? { referenceName: a.referenceName } : {}),
        ...(kind === 'video' && a.previewFrameTimeCode ? { previewFrameTimeCode: a.previewFrameTimeCode } : {}),
      },
      relationships: { assetLibrary: { data: { type: 'appAssetLibraries', id: libraryId } } },
    },
  };
}

export function assetCommitBody(kind: AssetKind, id: string) {
  return { data: { type: kind === 'image' ? 'appAssetLibraryImages' : 'appAssetLibraryVideos', id, attributes: { uploaded: true } } };
}

export function placementCreateBody(owner: Owner, asset: { kind: AssetKind; id: string }, placementType: AssetLibraryPlacementType, placementGroup: string) {
  return {
    data: {
      type: 'appAssetLibraryPlacements',
      attributes: { placementType, placementGroup },
      relationships: {
        [asset.kind]: { data: { type: asset.kind === 'image' ? 'appAssetLibraryImages' : 'appAssetLibraryVideos', id: asset.id } },
        [OWNER_RELATIONSHIP[owner.type]]: { data: { type: owner.type, id: owner.id } },
      },
    },
  };
}

export function orderingRequestBody(owner: Owner, placementGroup: string, placementIds: string[]) {
  if (owner.type === 'appEventLocalizations') throw new Error('Placement ordering requests do not accept In-App Event localizations (ASC API 4.5.1).');
  return {
    data: {
      type: 'appAssetLibraryPlacementOrderingRequests',
      attributes: { placementGroup },
      relationships: {
        orderedPlacements: { data: placementIds.map((id) => ({ type: 'appAssetLibraryPlacements', id })) },
        [OWNER_RELATIONSHIP[owner.type]]: { data: { type: owner.type, id: owner.id } },
      },
    },
  };
}

// ---- refData ----

export interface RefData {
  placementProfileGroups: Array<{ placementProfileGroupId?: string; platform?: string; displayClassId?: string }>;
  placementTypes: Array<{ placementTypeId?: string; acceptsAssetCategories?: string[]; specMappings?: Array<{ placementGroupId?: string; specs?: string[] }> }>;
  displayClasses: Array<{ displayClassId?: string; deviceFamily?: string; screenDimensions?: string[] }>;
  imageSpecs: Array<Record<string, unknown>>;
  videoSpecs: Array<Record<string, unknown>>;
}

/** AppAssetLibraryRefDataResponse (a list) or …RefDatumResponse (one item): the attributes of every item merged. */
export function parseRefData(doc: unknown): RefData {
  const out: RefData = { placementProfileGroups: [], placementTypes: [], displayClasses: [], imageSpecs: [], videoSpecs: [] };
  const data = (doc as { data?: unknown })?.data;
  const items = Array.isArray(data) ? data : data ? [data] : [];
  for (const item of items) {
    const a = ((item as { attributes?: Record<string, unknown> }).attributes ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(out) as Array<keyof RefData>) if (Array.isArray(a[key])) (out[key] as unknown[]).push(...(a[key] as unknown[]));
  }
  return out;
}

/**
 * The placementGroup id for one placement: the refData profile group whose platform and displayClassId match.
 * Header/search/event creatives fall back to DEFAULT_PROFILE when refData lists no group for them. Screenshots and
 * previews never fall back: without an exact group Vitrin refuses instead of placing into the wrong device set.
 */
export function resolvePlacementGroup(ref: RefData, spec: Pick<PlacementSpec, 'placementType' | 'displayClass' | 'platform'>): string {
  const native = NATIVE_PLACEMENTS.has(spec.placementType);
  const matches = ref.placementProfileGroups.filter((g) => g.displayClassId === spec.displayClass && (g.platform === spec.platform || (!native && spec.platform === 'ANY')) && g.placementProfileGroupId);
  const ids = [...new Set(matches.map((g) => g.placementProfileGroupId!))];
  let group: string;
  if (ids.length === 1) group = ids[0]!;
  else if (ids.length > 1 && !native && ids.includes(DEFAULT_CREATIVE_GROUP)) group = DEFAULT_CREATIVE_GROUP;
  else if (ids.length > 1) throw new Error(`refData lists several placement groups for ${spec.platform}/${spec.displayClass} (${ids.join(', ')}); refusing to guess.`);
  else if (!native) group = DEFAULT_CREATIVE_GROUP;
  else throw new Error(`refData has no placement group for ${spec.placementType} ${spec.platform}/${spec.displayClass}; see .vitrin/cache/refdata.json.`);
  const pt = ref.placementTypes.find((p) => p.placementTypeId === spec.placementType);
  const allowed = (pt?.specMappings ?? []).map((m) => m.placementGroupId).filter(Boolean);
  if (allowed.length && !allowed.includes(group)) throw new Error(`refData does not allow placement group ${group} for ${spec.placementType} (allowed: ${allowed.join(', ')}).`);
  return group;
}

// ---- client ----

type AssetAttrs = { state?: string; stateDetails?: Array<{ code?: string; description?: string }>; uploadOperations?: UploadOperation[] };
type PlacementAttrs = { placementType?: string; placementGroup?: string; mediaType?: string; state?: string };

/** AppAssetLibraryAssetState values after processing (COMPLETE for library media, then the review states). */
const READY_STATES = new Set(['COMPLETE', 'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'ACCEPTED', 'APPROVED']);

export class AssetLibraryClient {
  private ref?: RefData;

  constructor(
    private readonly asc: AscClient,
    private readonly opts: { uploadFetch?: typeof fetch; poll?: PollOptions } = {},
  ) {}

  async libraryId(appId: string): Promise<string> {
    const doc = await this.asc.get<JsonApiDocument>(`/v1/apps/${appId}/assetLibrary`);
    const data = Array.isArray(doc.data) ? doc.data[0] : doc.data;
    if (!data?.id) throw new Error('Could not read the Asset Library id (GET /v1/apps/{id}/assetLibrary returned no data.id).');
    return data.id;
  }

  async refData(): Promise<RefData> {
    this.ref ??= parseRefData(await this.asc.assetLibraryRefData());
    return this.ref;
  }

  async placementGroup(spec: PlacementSpec): Promise<string> {
    return resolvePlacementGroup(await this.refData(), spec);
  }

  /** Reserve, upload, commit (`uploaded: true`) and wait for processing. Returns the image/video id. */
  async upload(libraryId: string, file: string, kind: AssetKind, a: { category: AssetLibraryCategory; previewFrameTimeCode?: string }): Promise<string> {
    const type = kind === 'image' ? 'appAssetLibraryImages' : 'appAssetLibraryVideos';
    const bytes = await readFile(file);
    const reserve = await this.asc.request<JsonApiDocument<AssetAttrs>>('POST', `/v1/${type}`, assetCreateBody(kind, libraryId, { fileName: basename(file), fileSize: bytes.byteLength, category: a.category, previewFrameTimeCode: a.previewFrameTimeCode }));
    const res = (Array.isArray(reserve.data) ? reserve.data[0] : reserve.data) as JsonApiResource<AssetAttrs> | undefined;
    if (!res?.id || res.type !== type) throw new Error(`${type} reservation returned no ${type} resource.`);
    await performUploadOperations(res.attributes?.uploadOperations ?? [], bytes, file, this.opts.uploadFetch);
    await this.asc.request('PATCH', `/v1/${type}/${res.id}`, assetCommitBody(kind, res.id));
    await this.waitProcessed(type, res.id, basename(file), kind === 'video');
    return res.id;
  }

  private async waitProcessed(type: string, id: string, name: string, video: boolean): Promise<void> {
    const interval = this.opts.poll?.intervalMs ?? 5_000;
    const timeout = this.opts.poll?.timeoutMs ?? (video ? 20 * 60_000 : 5 * 60_000);
    const sleep = this.opts.poll?.sleep ?? defaultSleep;
    const started = Date.now();
    for (;;) {
      const doc = await this.asc.get<JsonApiDocument<AssetAttrs>>(`/v1/${type}/${id}`);
      const attrs = ((Array.isArray(doc.data) ? doc.data[0] : doc.data)?.attributes ?? {}) as AssetAttrs;
      const state = attrs.state;
      if (state && READY_STATES.has(state)) return;
      if (state === 'FAILED' || state === 'REJECTED' || state === 'ARCHIVED') {
        throw new Error(`${name}: Asset Library state ${state}${attrs.stateDetails?.length ? ` (${attrs.stateDetails.map((d) => d.description ?? d.code).join('; ')})` : ''}.`);
      }
      if (Date.now() - started >= timeout) {
        if (video) {
          log.warn(`${name} is still processing (${state ?? 'no state'}); videos can take up to 24 hours.`);
          return;
        }
        throw new Error(`${name}: still ${state ?? 'without a state'} after ${Math.round(timeout / 1000)} s.`);
      }
      await sleep(interval);
    }
  }

  /** Attach an uploaded image/video to an owner localization. */
  async place(owner: Owner, asset: { kind: AssetKind; id: string }, placementType: AssetLibraryPlacementType, placementGroup: string): Promise<string> {
    const doc = await this.asc.request<JsonApiDocument>('POST', '/v1/appAssetLibraryPlacements', placementCreateBody(owner, asset, placementType, placementGroup));
    const d = Array.isArray(doc.data) ? doc.data[0] : doc.data;
    if (!d?.id) throw new Error('POST /v1/appAssetLibraryPlacements returned no id.');
    return d.id;
  }

  /** Placements of exactly one type and group (server-side filters, checked again on the response). */
  async placements(owner: Owner, placementType: AssetLibraryPlacementType, placementGroup: string): Promise<Array<JsonApiResource<PlacementAttrs>>> {
    const q = `filter[placementType]=${placementType}&filter[placementGroup]=${encodeURIComponent(placementGroup)}&limit=200`;
    const list = await this.asc.getAll<PlacementAttrs>(`/v1/${owner.type}/${owner.id}/placements?${q}`);
    const foreign = list.filter((p) => p.attributes?.placementType !== placementType || p.attributes?.placementGroup !== placementGroup);
    if (foreign.length) {
      throw new Error(`Refusing to replace ${placementType}/${placementGroup}: the filtered placement list contains ${foreign.length} placement(s) of another type or group, so other device sets could be deleted.`);
    }
    return list;
  }

  /** Deletes the owner's placements of one type and group so a re-upload replaces the set. Returns the count. */
  async clearPlacements(owner: Owner, placementType: AssetLibraryPlacementType, placementGroup: string): Promise<number> {
    const victims = await this.placements(owner, placementType, placementGroup);
    for (const p of victims) await this.asc.request('DELETE', `/v1/appAssetLibraryPlacements/${p.id}`);
    return victims.length;
  }

  async order(owner: Owner, placementGroup: string, placementIds: string[]): Promise<void> {
    await this.asc.request('POST', '/v1/appAssetLibraryPlacementOrderingRequests', orderingRequestBody(owner, placementGroup, placementIds));
  }

  /**
   * Replaces one placement set (one owner, placement type and group): delete its placements, upload each file,
   * place it, then request the order. Returns the new placement ids.
   */
  async replaceSet(libraryId: string, owner: Owner, spec: PlacementSpec, files: Array<{ file: string; kind: AssetKind }>): Promise<{ group: string; removed: number; placements: string[] }> {
    const group = await this.placementGroup(spec);
    const removed = await this.clearPlacements(owner, spec.placementType, group);
    const placements: string[] = [];
    for (const f of files) {
      const id = await this.upload(libraryId, f.file, f.kind, { category: spec.category });
      placements.push(await this.place(owner, { kind: f.kind, id }, spec.placementType, group));
    }
    if (placements.length > 1 && owner.type !== 'appEventLocalizations') await this.order(owner, group, placements);
    return { group, removed, placements };
  }
}

/**
 * Compares refData with data/asc-display-types.json and the target sizes: every screenshot/preview mapping must have
 * a placement profile group, every display class must be one we know, and a display class that lists screen
 * dimensions should include the target's size.
 */
export function diffRefData(refData: unknown, targets: Array<{ id: string; kind: string; width: number; height: number }>, file: AscDisplayTypesFile = loadAscDisplayTypes()): string[] {
  const ref = parseRefData(refData);
  const out: string[] = [];
  if (!ref.placementProfileGroups.length && !ref.displayClasses.length) {
    return ['refData has no placementProfileGroups or displayClasses; its shape differs from the 4.5.1 spec (see .vitrin/cache/refdata.json).'];
  }
  const byId = new Map(targets.map((t) => [t.id, t]));
  for (const [id, d] of Object.entries(file.targets)) {
    const a = d.assetLibrary;
    const t = byId.get(id);
    if (!a || !t) continue;
    if (NATIVE_PLACEMENTS.has(a.placementType)) {
      try {
        resolvePlacementGroup(ref, a);
      } catch (err) {
        out.push(`${id}: ${(err as Error).message}`);
      }
    }
    const cls = ref.displayClasses.find((c) => c.displayClassId === a.displayClass);
    const dims = (cls?.screenDimensions ?? []).flatMap(parseDims);
    if (t.kind === 'screenshot' && a.displayClass !== 'DEFAULT' && dims.length && !dims.some(([w, h]) => (w === t.width && h === t.height) || (w === t.height && h === t.width))) {
      out.push(`${id}: ${t.width}×${t.height} is not among refData's ${a.displayClass} sizes (${cls!.screenDimensions!.join(', ')}).`);
    }
  }
  const known = new Set<string>(AssetLibraryDisplayClassEnum.options);
  for (const c of ref.displayClasses) if (c.displayClassId && !known.has(c.displayClassId)) out.push(`refData has a display class the 4.5.1 spec does not list: ${c.displayClassId}`);
  return [...new Set(out)];
}

function parseDims(s: string): Array<[number, number]> {
  const m = /(\d{2,5})\s*[x×X*]\s*(\d{2,5})/.exec(s);
  return m ? [[Number(m[1]), Number(m[2])]] : [];
}
