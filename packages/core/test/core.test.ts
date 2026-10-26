import { describe, expect, it } from 'vitest';
import {
  addSecret,
  byteLength,
  enabledTargets,
  graphemeLength,
  hashValue,
  loadStorefronts,
  loadTargets,
  mask,
  renderEnvExample,
  splitKeywords,
  storefrontForLocale,
  xcodeToAsc,
} from '../src/index.js';
import { VitrinConfig } from '@vitrin/schemas';

describe('byte and character counting', () => {
  it('counts Turkish letters as two UTF-8 bytes', () => {
    expect(byteLength('ç')).toBe(2);
    expect(byteLength('ışığı')).toBe(10);
    expect(byteLength('alışkanlık')).toBe(13); // ı, ş, ı
    expect(graphemeLength('alışkanlık')).toBe(10);
  });

  it('counts CJK as three bytes and emoji as one grapheme', () => {
    expect(byteLength('習慣')).toBe(6);
    expect(graphemeLength('👩‍👩‍👧')).toBe(1);
    expect(byteLength('👩‍👩‍👧')).toBe(18);
  });

  it('splits keyword fields on Latin and CJK commas', () => {
    expect(splitKeywords('a,b, c,,d')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitKeywords('習慣、記録，日記')).toEqual(['習慣', '記録', '日記']);
  });
});

describe('targets', () => {
  it('logical size × scale equals the delivery size for every target', () => {
    for (const t of loadTargets()) {
      expect(t.logical.width * t.logical.scale, t.id).toBe(t.width);
      expect(t.logical.height * t.logical.scale, t.id).toBe(t.height);
    }
  });

  it('matches the Oct 2026 required sizes', () => {
    const byId = Object.fromEntries(loadTargets().map((t) => [t.id, t]));
    expect([byId['iphone-6.3']!.width, byId['iphone-6.3']!.height]).toEqual([1206, 2622]);
    expect(byId['iphone-6.3']!.requirement).toBe('always');
    expect([byId['iphone-6.9']!.width, byId['iphone-6.9']!.height]).toEqual([1320, 2868]);
    expect([byId['ipad-13']!.width, byId['ipad-13']!.height]).toEqual([2064, 2752]);
    expect([byId['duo-outer']!.width, byId['duo-outer']!.height]).toEqual([1398, 2034]);
    expect([byId['duo-inner']!.width, byId['duo-inner']!.height]).toEqual([2007, 2853]);
    expect([byId['preview-iphone']!.width, byId['preview-iphone']!.height]).toEqual([886, 1920]);
    expect([byId['header']!.width, byId['header']!.height]).toEqual([3840, 1646]);
    expect(byId['preview-iphone']!.video!.fps).toEqual([30]);
  });

  it('enables iPad only for iPad apps and honours config overrides', () => {
    const config = VitrinConfig.parse({ app: {}, urls: {} });
    const phone = enabledTargets(config, { app: { supportsIPad: false } as never }).map((t) => t.id);
    expect(phone).toContain('iphone-6.3');
    expect(phone).not.toContain('ipad-13');
    const pad = enabledTargets(config, { app: { supportsIPad: true } as never }).map((t) => t.id);
    expect(pad).toContain('ipad-13');
    const custom = VitrinConfig.parse({ app: {}, urls: {}, targets: { disable: ['duo-inner'], enable: ['mac-16x10'] } });
    const ids = enabledTargets(custom, { app: { supportsIPad: false } as never }).map((t) => t.id);
    expect(ids).not.toContain('duo-inner');
    expect(ids).toContain('mac-16x10');
  });
});

describe('locales and storefronts', () => {
  it('maps Xcode regions to ASC locales', () => {
    expect(xcodeToAsc('en')).toBe('en-US');
    expect(xcodeToAsc('tr')).toBe('tr');
    expect(xcodeToAsc('pt-BR')).toBe('pt-BR');
    expect(xcodeToAsc('zh-Hans')).toBe('zh-Hans');
    expect(xcodeToAsc('de')).toBe('de-DE');
    expect(xcodeToAsc('xx')).toBeNull();
  });

  it('knows the storefront language table', () => {
    const mx = loadStorefronts().find((s) => s.code === 'mx')!;
    expect(mx.default).toBe('es-MX');
    expect(mx.additional).toEqual(['en-GB']);
    expect(loadStorefronts().find((s) => s.code === 'tr')!.additional).toEqual(['tr']);
    expect(storefrontForLocale('tr')).toBe('tr');
    expect(storefrontForLocale('en-US')).toBe('us');
    expect(storefrontForLocale('ja')).toBe('jp');
  });
});

describe('secrets', () => {
  it('masks registered secrets and PEM blocks', () => {
    addSecret('ABCD123456');
    expect(mask('key=ABCD123456')).toBe('key=AB***56');
    expect(mask('-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----')).toBe('[PRIVATE KEY]');
    expect(mask('Authorization: Bearer eyJhbGciOiJFUzI1NiJ9.payload.signature')).toBe('Authorization: Bearer ***');
  });

  it('renders .env.example with every key and its source', () => {
    const text = renderEnvExample(['MY_KEY=1']);
    expect(text).toContain('ASC_KEY_ID=');
    expect(text).toContain('Users and Access');
    expect(text).toContain('MY_KEY=1');
    expect(text).not.toMatch(/=\S+@/);
  });
});

describe('hashing', () => {
  it('is independent of key order', () => {
    expect(hashValue({ a: 1, b: [1, 2] })).toBe(hashValue({ b: [1, 2], a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});
