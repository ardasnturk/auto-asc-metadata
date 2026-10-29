import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

/** A fixture app workspace with everything the review gallery shows: metadata, screenshots, videos, creatives, CPP, events, a Play listing. */
export interface Fixture {
  root: string;
  shot: (locale: string, name: string) => string;
}

const COLORS = ['#5B4BDB', '#0E9F6E', '#E8590C', '#1C7ED6', '#C2255C'];

async function png(file: string, w: number, h: number, label: string, color: string): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const fs = Math.round(w / 12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/><rect x="${w * 0.12}" y="${h * 0.3}" width="${w * 0.76}" height="${h * 0.62}" rx="${w * 0.08}" fill="#fff" opacity=".92"/><text x="50%" y="${h * 0.14}" font-family="sans-serif" font-weight="700" font-size="${fs}" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  await sharp(Buffer.from(svg)).flatten({ background: color }).removeAlpha().png({ compressionLevel: 9 }).toFile(file);
}

function video(file: string, seconds: number, real: boolean): void {
  mkdirSync(dirname(file), { recursive: true });
  if (real) {
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=444x960:rate=30:duration=${seconds}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', file]);
      return;
    } catch {
      /* fall through to a placeholder */
    }
  }
  writeFileSync(file, Buffer.from(`fake mp4 ${file}`));
}

const json = (file: string, data: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
};
const text = (file: string, value: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
};

export async function makeFixture(opts: { realVideo?: boolean; android?: boolean } = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'vitrin-review-'));
  const locales = ['en-US', 'tr'];
  text(join(root, 'vitrin.config.yaml'), `app:\n  bundleId: com.example.ritim\n  primaryLocale: en-US\n  locales: [en-US, tr]\nurls:\n  support: https://example.com/support\n  privacy: https://example.com/privacy\ncopyrightHolder: Example Ltd\n`);
  text(join(root, '.env'), 'ASC_KEY_ID=SECRET\n');
  json(join(root, 'metadata', 'app_profile.json'), {
    generatedAt: '2026-10-26T00:00:00Z',
    project: { root: '.', targets: [] },
    app: { displayName: 'Ritim', bundleId: 'com.example.ritim', supportsIPad: false },
    features: [{ id: 'streaks', title: 'Streaks', description: 'Streak tracking', kind: 'core', evidence: [{ path: 'App.swift', line: 1 }], confidence: 'high', source: 'claude' }],
    brand: {},
    docs: {},
  });
  const copy: Record<string, { name: string; subtitle: string; promo: string; desc: string; kw: string; whatsNew: string; heads: string[] }> = {
    'en-US': { name: 'Ritim: Habit Tracker', subtitle: 'Build streaks that stick', promo: 'New: home screen widgets for every habit.', desc: 'Ritim helps you build habits that last.\nTrack streaks, see weekly charts and get gentle reminders.\nNo account needed.', kw: 'habit,streak,routine,goals,daily,tracker,reminder', whatsNew: 'Widgets and a fresh look.', heads: ['Build habits', 'Keep your streak', 'See your week'] },
    tr: { name: 'Ritim: Alışkanlık Takibi', subtitle: 'Seriyi bozma', promo: 'Yeni: her alışkanlık için widget.', desc: 'Ritim kalıcı alışkanlıklar kurmana yardım eder.\nSerilerini takip et.', kw: 'alışkanlık,seri,rutin,hedef,günlük', whatsNew: '', heads: ['Alışkanlık kur', 'Seriyi koru', 'Haftanı gör'] },
  };
  const images: unknown[] = [];
  const videos: unknown[] = [];
  for (const [li, locale] of locales.entries()) {
    const c = copy[locale]!;
    json(join(root, 'metadata', 'listing', `${locale}.json`), { locale, name: c.name, subtitle: c.subtitle, promotionalText: c.promo, description: c.desc, keywords: c.kw, whatsNew: c.whatsNew, claims: [] });
    for (const [ti, [target, w, h]] of ([['iphone-6.3', 1206, 2622], ['iphone-6.9', 1320, 2868]] as const).entries()) {
      for (const [i, head] of c.heads.entries()) {
        const id = String(i + 1).padStart(2, '0');
        const file = join(root, 'metadata', 'store', 'screenshots', locale, `${id}_shot${i + 1}_${target}.png`);
        await png(file, w, h, head, COLORS[(i + li + ti) % COLORS.length]!);
        images.push({ file, target, locale, shot: id, width: w, height: h, overflow: [], safeAreaViolations: [] });
      }
    }
    const pv = join(root, 'metadata', 'store', 'app-previews', locale, '01_IPHONE_67.mp4');
    video(pv, 2, Boolean(opts.realVideo));
    videos.push({ file: pv, target: 'preview-iphone', locale, id: '01', durationSec: 2 });
    const header = join(root, 'metadata', 'creative', locale, 'header_header.png');
    await png(header, 3840, 1646, `Header ${locale}`, '#343A40');
    images.push({ file: header, target: 'header', locale, shot: 'header', width: 3840, height: 1646, overflow: [], safeAreaViolations: [] });
    const card = join(root, 'metadata', 'creative', locale, 'event-card_event-launch-card.png');
    await png(card, 1920, 1080, `Event ${locale}`, '#862E9C');
    images.push({ file: card, target: 'event-card', locale, shot: 'event-launch-card', width: 1920, height: 1080, overflow: [], safeAreaViolations: [] });
    // Intermediate render output that is never uploaded.
    text(join(root, 'metadata', 'creative', locale, 'header_loop.remotion.mp4'), 'tmp');
  }
  json(join(root, 'metadata', 'listing', 'app.json'), { copyright: '2026 Example Ltd', primaryCategory: 'HEALTH_AND_FITNESS', secondaryCategory: 'PRODUCTIVITY', reviewNotes: 'Demo mode: launch with -VitrinDemo.' });
  json(join(root, 'metadata', 'render-manifest.json'), { generatedAt: '2026-10-26T00:00:00Z', artDirection: 'calm-gradient', images, videos });
  json(join(root, 'metadata', 'cpp-suggestions.json'), {
    pages: [{ id: 'students', name: 'Study habits', segment: 'Students', rationale: 'Search terms around study routines.', keywords: ['study', 'focus'], promotionalText: { 'en-US': 'Build a study routine.', tr: 'Ders rutini kur.' }, shots: ['01', '02'], featureIds: ['streaks'] }],
  });
  const spec = { copy: { 'en-US': { headline: 'Launch week' }, tr: { headline: 'Lansman haftası' } }, screens: ['home'], featureIds: ['streaks'], badges: [] };
  json(join(root, 'metadata', 'shots.json'), {
    shots: [{ id: '01', slug: 'shot1', archetype: 'hero', screens: ['home'], copy: { 'en-US': { headline: 'Build habits' }, tr: { headline: 'Alışkanlık kur' } }, featureIds: ['streaks'] }],
    creatives: {
      events: [{ id: 'launch', badge: 'SPECIAL_EVENT', name: { 'en-US': 'Launch week', tr: 'Lansman haftası' }, shortDescription: { 'en-US': 'Double streak points', tr: 'Çift seri puanı' }, longDescription: { 'en-US': 'All week long every check-in counts twice.', tr: 'Tüm hafta her giriş iki kez sayılır.' }, card: spec, detail: spec }],
    },
  });
  const shotFile = (locale: string, name: string) => join(root, 'metadata', 'store', 'screenshots', locale, name);
  json(join(root, 'metadata', 'validation.json'), {
    generatedAt: '2026-10-26T00:00:00Z',
    // No errors: approval refuses content whose last validation found errors (approval.test covers that).
    ok: true,
    counts: { error: 0, warning: 2, info: 0 },
    issues: [
      { severity: 'warning', code: 'image.contrast', message: 'en-US 02 iphone-6.9: text contrast is 2.10:1.', locale: 'en-US', file: shotFile('en-US', '02_shot2_iphone-6.9.png') },
      { severity: 'warning', code: 'text.subtitle-duplicate', message: 'Subtitle repeats a word from the name.', locale: 'tr', field: 'subtitle', file: 'metadata/listing/tr.json' },
    ],
    measurements: {},
  });
  if (opts.android !== false) {
    const play = join(root, 'metadata', 'store', 'metadata', 'android', 'en-US');
    text(join(play, 'title.txt'), 'Ritim: Habit Tracker\n');
    text(join(play, 'short_description.txt'), 'Build streaks that stick, one day at a time.\n');
    text(join(play, 'full_description.txt'), 'Ritim helps you build habits that last.\n');
    text(join(play, 'changelogs', '42.txt'), 'Widgets.\n');
    for (let i = 1; i <= 2; i++) await png(join(play, 'images', 'phoneScreenshots', `${i}_shot${i}.png`), 1080, 1920, `Android ${i}`, COLORS[i]!);
    await png(join(play, 'images', 'featureGraphic.png'), 1024, 500, 'Feature graphic', '#2B8A3E');
  }
  return { root, shot: shotFile };
}
