import { log } from '@vitrin/core';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AscClient, JsonApiDocument, JsonApiResource } from './asc-client.js';

/**
 * App Asset Library client (ASC API 4.5.1).
 *
 * VERIFIED from the release notes: the endpoint paths below, and that App Screenshot Sets / Screenshots /
 * Preview Sets / Previews and App Event Screenshots / Video Clips are deprecated in favour of these resources.
 * NOT VERIFIED (Apple's pages returned no body when this was written): attribute names, placement types and the
 * refData shape. The upload flow follows the long-standing ASC asset pattern (reserve → uploadOperations → PUT →
 * commit with MD5 checksum → poll deliveryState). Every response is checked defensively and unknown shapes raise
 * an error that names the field, so a mismatch is caught on the first run instead of silently skipped.
 */

export interface UploadOperation {
  method: string;
  url: string;
  offset: number;
  length: number;
  requestHeaders?: Array<{ name: string; value: string }>;
}

type AssetType = 'appAssetLibraryImages' | 'appAssetLibraryVideos';

export class AssetLibraryClient {
  constructor(private readonly asc: AscClient) {}

  async libraryId(appId: string): Promise<string> {
    const doc = await this.asc.get<JsonApiDocument>(`/v1/apps/${appId}/assetLibrary`);
    const data = Array.isArray(doc.data) ? doc.data[0] : doc.data;
    if (!data?.id) throw new Error('Asset Library kimliği okunamadı (GET /v1/apps/{id}/assetLibrary yanıtı beklenmedik).');
    return data.id;
  }

  async refData(): Promise<unknown> {
    return this.asc.assetLibraryRefData();
  }

  /** Reserve, upload and commit one file. Returns the asset resource id once processing completes. */
  async upload(libraryId: string, file: string, kind: 'image' | 'video'): Promise<string> {
    const type: AssetType = kind === 'image' ? 'appAssetLibraryImages' : 'appAssetLibraryVideos';
    const bytes = await readFile(file);
    const size = (await stat(file)).size;
    const reserve = await this.asc.request<JsonApiDocument<{ uploadOperations?: UploadOperation[] }>>('POST', `/v1/${type}`, {
      data: {
        type,
        attributes: { fileName: basename(file), fileSize: size },
        relationships: { appAssetLibrary: { data: { type: 'appAssetLibraries', id: libraryId } } },
      },
    });
    const res = reserve.data as JsonApiResource<{ uploadOperations?: UploadOperation[] }>;
    const ops = res.attributes.uploadOperations;
    if (!res.id || !Array.isArray(ops)) throw new Error(`${type} rezervasyonu beklenmeyen yanıt döndü (uploadOperations yok).`);
    for (const op of ops) {
      const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
      const r = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
      if (!r.ok) throw new Error(`Parça yüklenemedi (${r.status}) ${basename(file)} @${op.offset}`);
    }
    const checksum = createHash('md5').update(bytes).digest('hex');
    await this.asc.request('PATCH', `/v1/${type}/${res.id}`, {
      data: { type, id: res.id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    });
    await this.waitProcessed(type, res.id, kind === 'video' ? 30 * 60_000 : 5 * 60_000);
    return res.id;
  }

  private async waitProcessed(type: AssetType, id: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    for (;;) {
      const doc = await this.asc.get<JsonApiDocument<{ assetDeliveryState?: { state?: string; errors?: Array<{ description?: string }> }; deliveryState?: { state?: string } }>>(`/v1/${type}/${id}`);
      const attrs = (doc.data as JsonApiResource<{ assetDeliveryState?: { state?: string; errors?: Array<{ description?: string }> }; deliveryState?: { state?: string } }>).attributes;
      const state = attrs.assetDeliveryState?.state ?? attrs.deliveryState?.state;
      if (state === 'COMPLETE') return;
      if (state === 'FAILED') throw new Error(`İşleme başarısız: ${attrs.assetDeliveryState?.errors?.map((e) => e.description).join('; ') ?? id}`);
      if (Date.now() - started > timeoutMs) {
        log.warn(`${id} hâlâ işleniyor (${state ?? 'durum yok'}); videolar 24 saate kadar sürebilir. Yerleşim sonra eklenebilir.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  /** Attach an asset to a localization (version, custom product page or in-app event) as a placement. */
  async place(assetId: string, kind: 'image' | 'video', owner: { type: string; id: string }, placementType: string, displayClass?: string): Promise<string> {
    const doc = await this.asc.request<JsonApiDocument>('POST', '/v1/appAssetLibraryPlacements', {
      data: {
        type: 'appAssetLibraryPlacements',
        attributes: { placementType, ...(displayClass ? { displayClass } : {}) },
        relationships: {
          asset: { data: { type: kind === 'image' ? 'appAssetLibraryImages' : 'appAssetLibraryVideos', id: assetId } },
          [ownerRelationship(owner.type)]: { data: owner },
        },
      },
    });
    return (doc.data as JsonApiResource).id;
  }

  /**
   * Deletes the owner's placements of one type/display class so a re-upload replaces the set instead of
   * appending to it. Returns how many were removed.
   */
  async clearPlacements(owner: { type: string; id: string }, placementType: string, displayClass?: string): Promise<number> {
    const list = await this.asc.getAll<{ placementType?: string; displayClass?: string }>(`/v1/${owner.type}/${owner.id}/placements?limit=200`);
    const victims = list.filter((p) => (!p.attributes.placementType || p.attributes.placementType === placementType) && (!displayClass || !p.attributes.displayClass || p.attributes.displayClass === displayClass));
    for (const p of victims) await this.asc.request('DELETE', `/v1/appAssetLibraryPlacements/${p.id}`);
    return victims.length;
  }

  /** Request a display order for placements of one owner/class. */
  async order(placementIds: string[]): Promise<void> {
    await this.asc.request('POST', '/v1/appAssetLibraryPlacementOrderingRequests', {
      data: {
        type: 'appAssetLibraryPlacementOrderingRequests',
        relationships: { placements: { data: placementIds.map((id) => ({ type: 'appAssetLibraryPlacements', id })) } },
      },
    });
  }
}

function ownerRelationship(type: string): string {
  return (
    {
      appStoreVersionLocalizations: 'appStoreVersionLocalization',
      appCustomProductPageLocalizations: 'appCustomProductPageLocalization',
      appEventLocalizations: 'appEventLocalization',
      appStoreVersionExperimentTreatmentLocalizations: 'appStoreVersionExperimentTreatmentLocalization',
    }[type] ?? type
  );
}

/**
 * Compare refData with data/targets.json. Because the shape is unverified we search the JSON for any
 * object carrying width/height (or displayClass) and report classes/sizes we do not know about.
 */
export function diffRefData(refData: unknown, known: Array<{ width: number; height: number; assetLibraryDisplayClass?: string }>): string[] {
  const found: Array<{ cls?: string; w?: number; h?: number }> = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const w = num(o.width ?? o.pixelWidth);
      const h = num(o.height ?? o.pixelHeight);
      const cls = typeof o.displayClass === 'string' ? o.displayClass : typeof o.displayType === 'string' ? o.displayType : undefined;
      if (cls || (w && h)) found.push({ cls, w, h });
      Object.values(o).forEach(walk);
    }
  };
  walk(refData);
  const out: string[] = [];
  const knownSizes = new Set(known.flatMap((k) => [`${k.width}x${k.height}`, `${k.height}x${k.width}`]));
  const knownClasses = new Set(known.map((k) => k.assetLibraryDisplayClass).filter(Boolean));
  for (const f of found) {
    if (f.cls && !knownClasses.has(f.cls)) out.push(`refData yeni/eşleşmeyen sınıf: ${f.cls}${f.w ? ` (${f.w}×${f.h})` : ''}`);
    else if (f.w && f.h && !knownSizes.has(`${f.w}x${f.h}`)) out.push(`refData targets.json’da olmayan boyut: ${f.w}×${f.h}${f.cls ? ` (${f.cls})` : ''}`);
  }
  if (!found.length) out.push('refData yanıtında boyut/sınıf bulunamadı; yanıt biçimi beklenenden farklı olabilir (.vitrin/cache/refdata.json’a bak).');
  return [...new Set(out)];
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined;
}
