import { log } from '@vitrin/core';
import type { PreviewType, ScreenshotDisplayType } from '@vitrin/schemas';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { AscClient, JsonApiDocument, JsonApiResource } from './asc-client.js';
import { defaultSleep, md5, performUploadOperations, type PollOptions, type UploadOperation } from './upload-operations.js';

/**
 * Per-display-type replacement with the classic App Store Connect media API (appScreenshotSets / appPreviewSets),
 * checked against the App Store Connect API 4.5.1 OpenAPI spec (AppScreenshotSetCreateRequest,
 * AppScreenshotCreateRequest, AppScreenshotUpdateRequest, AppScreenshotSetAppScreenshotsLinkagesRequest and the
 * AppPreview* equivalents). The 4.5.1 release notes deprecate these resources in favour of the App Asset Library,
 * but the 4.5.1 spec still publishes every operation used here without a `deprecated` flag, and fastlane deliver and
 * the asc CLI use them.
 *
 * Unlike deliver's overwrite (which deletes every set of a locale), this touches exactly one set: it finds (or
 * creates) the set of one localization and one display type, deletes only that set's items, uploads the new files
 * (reserve → upload operations → commit with the MD5 `sourceFileChecksum` → poll the delivery state) and sets the
 * order. The flow follows the one in rorkai/App-Store-Connect-CLI (MIT; internal/cli/assets).
 */

/** Apple's per-set limits: 10 screenshots, 3 App Previews. */
export const MAX_SCREENSHOTS_PER_SET = 10;
export const MAX_PREVIEWS_PER_SET = 3;

type Rel<T extends string> = { data: { type: T; id: string } };

export function screenshotSetCreateBody(localizationId: string, screenshotDisplayType: ScreenshotDisplayType) {
  return {
    data: {
      type: 'appScreenshotSets' as const,
      attributes: { screenshotDisplayType },
      relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localizationId } } as Rel<'appStoreVersionLocalizations'> },
    },
  };
}

export function screenshotCreateBody(setId: string, fileName: string, fileSize: number) {
  return {
    data: {
      type: 'appScreenshots' as const,
      attributes: { fileName, fileSize },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } as Rel<'appScreenshotSets'> },
    },
  };
}

export function screenshotCommitBody(id: string, sourceFileChecksum: string) {
  return { data: { type: 'appScreenshots' as const, id, attributes: { uploaded: true, sourceFileChecksum } } };
}

export function screenshotOrderBody(ids: string[]) {
  return { data: ids.map((id) => ({ type: 'appScreenshots' as const, id })) };
}

export function previewSetCreateBody(localizationId: string, previewType: PreviewType) {
  return {
    data: {
      type: 'appPreviewSets' as const,
      attributes: { previewType },
      relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localizationId } } as Rel<'appStoreVersionLocalizations'> },
    },
  };
}

export function previewCreateBody(setId: string, fileName: string, fileSize: number, opts: { mimeType?: string; previewFrameTimeCode?: string } = {}) {
  return {
    data: {
      type: 'appPreviews' as const,
      attributes: { fileName, fileSize, ...(opts.mimeType ? { mimeType: opts.mimeType } : {}), ...(opts.previewFrameTimeCode ? { previewFrameTimeCode: opts.previewFrameTimeCode } : {}) },
      relationships: { appPreviewSet: { data: { type: 'appPreviewSets', id: setId } } as Rel<'appPreviewSets'> },
    },
  };
}

export function previewCommitBody(id: string, sourceFileChecksum: string, previewFrameTimeCode?: string) {
  return { data: { type: 'appPreviews' as const, id, attributes: { uploaded: true, sourceFileChecksum, ...(previewFrameTimeCode ? { previewFrameTimeCode } : {}) } } };
}

export function previewOrderBody(ids: string[]) {
  return { data: ids.map((id) => ({ type: 'appPreviews' as const, id })) };
}

/** `HH:MM:SS:FF` (frames) or `HH:MM:SS.mmm`, the poster-frame formats App Store Connect accepts. */
export function isPreviewFrameTimeCode(tc: string): boolean {
  return /^\d{2}:[0-5]\d:[0-5]\d:([0-2]\d)$/.test(tc) || /^\d{2}:[0-5]\d:[0-5]\d\.\d{3}$/.test(tc);
}

export function previewMimeType(file: string): string {
  const ext = extname(file).toLowerCase();
  const mime = { '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.mp4': 'video/mp4' }[ext];
  if (!mime) throw new Error(`${basename(file)}: App Previews must be .mov, .m4v or .mp4.`);
  return mime;
}

type DeliveryState = { state?: string; errors?: Array<{ code?: string; message?: string; description?: string }> };
type MediaAttrs = { uploadOperations?: UploadOperation[]; assetDeliveryState?: DeliveryState; videoDeliveryState?: DeliveryState };

export interface ReplaceResult {
  setId: string;
  createdSet: boolean;
  deleted: number;
  uploaded: string[];
}

export class ClassicMediaClient {
  constructor(
    private readonly asc: AscClient,
    private readonly opts: { uploadFetch?: typeof fetch; poll?: PollOptions } = {},
  ) {}

  /** The set of exactly this display type in one version localization (filter[screenshotDisplayType]). */
  async findScreenshotSet(localizationId: string, displayType: ScreenshotDisplayType): Promise<JsonApiResource<{ screenshotDisplayType?: string }> | undefined> {
    const sets = await this.asc.getAll<{ screenshotDisplayType?: string }>(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?filter[screenshotDisplayType]=${displayType}&limit=50`);
    return pickSet(sets, 'screenshotDisplayType', displayType);
  }

  async findPreviewSet(localizationId: string, previewType: PreviewType): Promise<JsonApiResource<{ previewType?: string }> | undefined> {
    const sets = await this.asc.getAll<{ previewType?: string }>(`/v1/appStoreVersionLocalizations/${localizationId}/appPreviewSets?filter[previewType]=${previewType}&limit=50`);
    return pickSet(sets, 'previewType', previewType);
  }

  /**
   * Replaces the screenshots of one display type in one localization and nothing else.
   * Files are uploaded in the given order, and that order is set on the set afterwards.
   */
  async replaceScreenshotSet(localizationId: string, displayType: ScreenshotDisplayType, files: string[]): Promise<ReplaceResult> {
    if (!files.length) throw new Error(`${displayType}: no files to upload.`);
    if (files.length > MAX_SCREENSHOTS_PER_SET) throw new Error(`${displayType}: ${files.length} screenshots; a set holds at most ${MAX_SCREENSHOTS_PER_SET}.`);
    // Read every file first, so a missing file fails before anything is deleted.
    const contents = await Promise.all(files.map(async (f) => ({ file: f, bytes: await readFile(f) })));
    let set = await this.findScreenshotSet(localizationId, displayType);
    let createdSet = false;
    if (!set) {
      set = idOrThrow(await this.asc.request<JsonApiDocument<{ screenshotDisplayType?: string }>>('POST', '/v1/appScreenshotSets', screenshotSetCreateBody(localizationId, displayType)), 'appScreenshotSets') as JsonApiResource<{ screenshotDisplayType?: string }>;
      createdSet = true;
    }
    let deleted = 0;
    if (!createdSet) {
      const existing = await this.asc.getAll(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
      for (const s of existing) {
        await this.asc.request('DELETE', `/v1/appScreenshots/${s.id}`);
        deleted++;
      }
    }
    const uploaded: string[] = [];
    for (const { file, bytes } of contents) {
      const reserved = idOrThrow(await this.asc.request<JsonApiDocument<MediaAttrs>>('POST', '/v1/appScreenshots', screenshotCreateBody(set.id, basename(file), bytes.byteLength)), 'appScreenshots') as JsonApiResource<MediaAttrs>;
      await performUploadOperations(reserved.attributes?.uploadOperations ?? [], bytes, file, this.opts.uploadFetch);
      await this.asc.request('PATCH', `/v1/appScreenshots/${reserved.id}`, screenshotCommitBody(reserved.id, md5(bytes)));
      await this.waitDelivered('appScreenshots', reserved.id, basename(file), false);
      uploaded.push(reserved.id);
    }
    if (uploaded.length > 1) await this.asc.request('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, screenshotOrderBody(uploaded));
    return { setId: set.id, createdSet, deleted, uploaded };
  }

  /** Replaces the App Previews of one preview type in one localization and nothing else. */
  async replacePreviewSet(localizationId: string, previewType: PreviewType, files: string[], opts: { previewFrameTimeCode?: string } = {}): Promise<ReplaceResult> {
    if (!files.length) throw new Error(`${previewType}: no files to upload.`);
    if (files.length > MAX_PREVIEWS_PER_SET) throw new Error(`${previewType}: ${files.length} App Previews; a set holds at most ${MAX_PREVIEWS_PER_SET}.`);
    const tc = opts.previewFrameTimeCode;
    if (tc && !isPreviewFrameTimeCode(tc)) throw new Error(`previewFrameTimeCode “${tc}” is not HH:MM:SS:FF or HH:MM:SS.mmm.`);
    const contents = await Promise.all(files.map(async (f) => ({ file: f, bytes: await readFile(f), mimeType: previewMimeType(f) })));
    let set = await this.findPreviewSet(localizationId, previewType);
    let createdSet = false;
    if (!set) {
      set = idOrThrow(await this.asc.request<JsonApiDocument<{ previewType?: string }>>('POST', '/v1/appPreviewSets', previewSetCreateBody(localizationId, previewType)), 'appPreviewSets') as JsonApiResource<{ previewType?: string }>;
      createdSet = true;
    }
    let deleted = 0;
    if (!createdSet) {
      const existing = await this.asc.getAll(`/v1/appPreviewSets/${set.id}/appPreviews?limit=50`);
      for (const p of existing) {
        await this.asc.request('DELETE', `/v1/appPreviews/${p.id}`);
        deleted++;
      }
    }
    const uploaded: string[] = [];
    for (const { file, bytes, mimeType } of contents) {
      const reserved = idOrThrow(await this.asc.request<JsonApiDocument<MediaAttrs>>('POST', '/v1/appPreviews', previewCreateBody(set.id, basename(file), bytes.byteLength, { mimeType, previewFrameTimeCode: tc })), 'appPreviews') as JsonApiResource<MediaAttrs>;
      await performUploadOperations(reserved.attributes?.uploadOperations ?? [], bytes, file, this.opts.uploadFetch);
      await this.asc.request('PATCH', `/v1/appPreviews/${reserved.id}`, previewCommitBody(reserved.id, md5(bytes), tc));
      await this.waitDelivered('appPreviews', reserved.id, basename(file), true);
      uploaded.push(reserved.id);
    }
    if (uploaded.length > 1) await this.asc.request('PATCH', `/v1/appPreviewSets/${set.id}/relationships/appPreviews`, previewOrderBody(uploaded));
    return { setId: set.id, createdSet, deleted, uploaded };
  }

  /**
   * Polls until COMPLETE. Screenshots must finish (FAILED or a timeout is an error); App Preview processing can take
   * up to 24 hours, so a preview still processing at the timeout is reported and left to finish on Apple's side.
   */
  private async waitDelivered(type: 'appScreenshots' | 'appPreviews', id: string, name: string, video: boolean): Promise<void> {
    const interval = this.opts.poll?.intervalMs ?? 5_000;
    const timeout = this.opts.poll?.timeoutMs ?? (video ? 20 * 60_000 : 5 * 60_000);
    const sleep = this.opts.poll?.sleep ?? defaultSleep;
    const started = Date.now();
    for (;;) {
      const doc = await this.asc.get<JsonApiDocument<MediaAttrs>>(`/v1/${type}/${id}`);
      const attrs = (Array.isArray(doc.data) ? doc.data[0] : doc.data)?.attributes ?? {};
      // AppPreview.assetDeliveryState is deprecated in 4.5.1 in favour of videoDeliveryState.
      const delivery = (video ? (attrs.videoDeliveryState ?? attrs.assetDeliveryState) : attrs.assetDeliveryState) ?? {};
      if (delivery.state === 'COMPLETE') return;
      if (delivery.state === 'FAILED') {
        const why = (delivery.errors ?? []).map((e) => e.description ?? e.message ?? e.code).filter(Boolean).join('; ');
        throw new Error(`${name}: App Store Connect could not process the file${why ? ` (${why})` : ''}.`);
      }
      if (Date.now() - started >= timeout) {
        if (video) {
          log.warn(`${name} is still processing (${delivery.state ?? 'no state'}); App Previews can take up to 24 hours.`);
          return;
        }
        throw new Error(`${name}: still ${delivery.state ?? 'without a delivery state'} after ${Math.round(timeout / 1000)} s.`);
      }
      await sleep(interval);
    }
  }
}

function pickSet<K extends string>(sets: Array<JsonApiResource<Partial<Record<K, string>>>>, key: K, value: string) {
  const exact = sets.filter((s) => s.attributes?.[key] === value);
  // The filter should already have narrowed the list; anything else in it means we cannot trust which set is which.
  const other = sets.filter((s) => s.attributes?.[key] !== value);
  if (other.length) throw new Error(`App Store Connect returned ${other.map((s) => s.attributes?.[key] ?? '(no type)').join(', ')} for filter ${key}=${value}; refusing to touch any set.`);
  if (exact.length > 1) throw new Error(`More than one ${value} set in this localization (${exact.map((s) => s.id).join(', ')}); refusing to guess.`);
  return exact[0];
}

function idOrThrow(doc: JsonApiDocument<unknown> | undefined, type: string): JsonApiResource<unknown> {
  const d = doc && (Array.isArray(doc.data) ? doc.data[0] : doc.data);
  if (!d?.id) throw new Error(`POST /v1/${type} returned no resource id.`);
  return d;
}
