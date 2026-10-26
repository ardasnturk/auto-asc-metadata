import { ensureDir, exec, log } from '@vitrin/core';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Runner } from './build.js';
import { sleep } from './simulator.js';

/**
 * Android capture: a dedicated AVD per device profile, System UI demo mode (09:41, full battery and signal,
 * no notifications), per-app language, launch with the demo/screen intent extras, `screencap` and `screenrecord`.
 * Command construction is pure so it can be tested without an SDK.
 */

export interface AndroidTools {
  adb: string;
  emulator: string;
  avdmanager: string;
  sdkRoot?: string;
}

/** SDK tools from ANDROID_HOME / ANDROID_SDK_ROOT, falling back to whatever is on PATH. */
export function androidTools(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): AndroidTools {
  const sdkRoot = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || undefined;
  const pick = (rel: string[], fallback: string) => {
    if (!sdkRoot) return fallback;
    const found = rel.map((r) => join(sdkRoot, r)).find((p) => exists(p));
    return found ?? fallback;
  };
  return {
    sdkRoot,
    adb: pick(['platform-tools/adb'], 'adb'),
    emulator: pick(['emulator/emulator'], 'emulator'),
    avdmanager: pick(['cmdline-tools/latest/bin/avdmanager', 'tools/bin/avdmanager'], 'avdmanager'),
  };
}

/** AVD name Vitrin creates for a device profile, e.g. `pixel_9` → `Vitrin_pixel_9`. */
export function avdNameFor(deviceProfile: string): string {
  return `Vitrin_${deviceProfile.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
}

export function parseAvdList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('INFO') && !l.includes(' '));
}

/**
 * Newest installed system image with Google APIs (Play Store images cannot run `adb root`, but demo mode
 * does not need root, so they are accepted after google_apis). Input: `android-36/google_apis/arm64-v8a` paths.
 */
export function pickSystemImage(images: string[], arch: string = process.arch): string | undefined {
  const abi = arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const rank = (tag: string) => (tag === 'google_apis' ? 0 : tag === 'google_apis_playstore' ? 1 : tag === 'default' ? 2 : 3);
  const parsed = images
    .map((p) => p.split('/'))
    .filter((p) => p.length === 3 && /^android-\d+/.test(p[0]!) && p[2] === abi)
    .map(([api, tag, a]) => ({ api: Number(/\d+/.exec(api!)![0]), tag: tag!, id: `system-images;${api};${tag};${a}` }))
    .sort((x, y) => y.api - x.api || rank(x.tag) - rank(y.tag));
  return parsed[0]?.id;
}

export function installedSystemImages(sdkRoot: string): string[] {
  const base = join(sdkRoot, 'system-images');
  const out: string[] = [];
  try {
    for (const api of readdirSync(base)) for (const tag of readdirSync(join(base, api))) for (const abi of readdirSync(join(base, api, tag))) out.push(`${api}/${tag}/${abi}`);
  } catch {
    // no images
  }
  return out;
}

export function avdCreateArgs(name: string, image: string, deviceProfile: string): string[] {
  return ['create', 'avd', '-n', name, '-k', image, '-d', deviceProfile, '--force'];
}

/** A fixed console port gives a predictable serial (`emulator-<port>`) and never collides with the user's emulators. */
export function emulatorArgs(avd: string, port: number, headless: boolean): string[] {
  return ['-avd', avd, '-port', String(port), '-no-snapshot-save', '-no-boot-anim', '-no-audio', ...(headless ? ['-no-window'] : [])];
}

export const serialFor = (port: number) => `emulator-${port}`;

/** `adb shell` commands that put System UI into demo mode (Android's equivalent of the 9:41 status bar). */
export function demoModeCommands(): string[][] {
  const demo = (...extra: string[]) => ['am', 'broadcast', '-a', 'com.android.systemui.demo', ...extra];
  return [
    ['settings', 'put', 'global', 'sysui_demo_allowed', '1'],
    demo('-e', 'command', 'enter'),
    demo('-e', 'command', 'clock', '-e', 'hhmm', '0941'),
    demo('-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false'),
    demo('-e', 'command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4', '-e', 'fully', 'true'),
    demo('-e', 'command', 'network', '-e', 'mobile', 'show', '-e', 'datatype', 'none', '-e', 'level', '4', '-e', 'fully', 'true'),
    demo('-e', 'command', 'notifications', '-e', 'visible', 'false'),
  ];
}

export function demoModeExit(): string[] {
  return ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit'];
}

/** `-VitrinScreen home` → `vitrinScreen`: launch argument names become lowerCamel intent extra keys. */
export function extraKey(arg: string): string {
  const name = arg.replace(/^-+/, '');
  return name[0]!.toLowerCase() + name.slice(1);
}

/**
 * Converts iOS-style launch arguments to `am start` extras:
 * `-VitrinDemo` → `--ez vitrinDemo true`; `-VitrinScreen home` → `--es vitrinScreen home`;
 * `-Flag YES|NO|true|false` → boolean; integers → `--ei`.
 */
export function launchArgsToExtras(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('-')) continue;
    const next = args[i + 1];
    const key = extraKey(a);
    if (next === undefined || next.startsWith('-')) {
      out.push('--ez', key, 'true');
      continue;
    }
    i++;
    if (/^(YES|NO|true|false)$/i.test(next)) out.push('--ez', key, /^(YES|true)$/i.test(next) ? 'true' : 'false');
    else if (/^-?\d+$/.test(next)) out.push('--ei', key, next);
    else out.push('--es', key, next);
  }
  return out;
}

/** ASC locale → BCP 47 tag for Android (`tr` → `tr-TR`, `zh-Hans` → `zh-Hans-CN`, `no` → `nb-NO`). */
export function androidLocaleTag(locale: string, storefront: string): string {
  const parts = (locale === 'no' ? 'nb' : locale).split('-');
  const lang = parts[0]!;
  const rest = parts.slice(1);
  const script = rest.find((p) => p.length === 4);
  const region = rest.find((p) => p.length === 2)?.toUpperCase() ?? (script === 'Hans' ? 'CN' : script === 'Hant' ? 'TW' : storefront.toUpperCase());
  return [lang, script, region].filter(Boolean).join('-');
}

/** Per-app language (Android 13+) — the app sees the locale without changing the device language. */
export function appLocaleArgs(appId: string, tag: string): string[] {
  return ['cmd', 'locale', 'set-app-locales', appId, '--user', 'current', '--locales', tag];
}

/** `pkg/.MainActivity` from `cmd package resolve-activity --brief`, which prints the component on its last line. */
export function parseResolvedActivity(stdout: string, appId: string): string | undefined {
  const line = stdout.trim().split('\n').map((l) => l.trim()).reverse().find((l) => l.startsWith(`${appId}/`));
  return line;
}

export function componentFor(appId: string, activity: string): string {
  return activity.includes('/') ? activity : `${appId}/${activity}`;
}

/** `am start` that cold-starts (-S) and waits (-W) with the Vitrin extras; an optional deep link is opened as VIEW data. */
export function amStartArgs(component: string, extras: string[], url?: string): string[] {
  return ['am', 'start', '-W', '-S', '-n', component, ...(url ? ['-a', 'android.intent.action.VIEW', '-d', url] : []), ...extras];
}

/** `Physical size: 1600x2560` (+ optional `Override size:`) → effective size. */
export function parseWmSize(stdout: string): { width: number; height: number } | undefined {
  const m = [...stdout.matchAll(/(\d+)x(\d+)/g)].pop();
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

export interface AndroidDeviceOptions {
  tools: AndroidTools;
  runner?: Runner;
  serial: string;
}

/** Thin wrapper around one emulator serial. Every adb call goes through the injectable runner. */
export class AndroidDevice {
  private readonly runner: Runner;
  constructor(
    readonly tools: AndroidTools,
    readonly serial: string,
    runner: Runner = exec,
  ) {
    this.runner = runner;
  }

  adb(args: string[], timeoutMs = 120_000) {
    return this.runner(this.tools.adb, ['-s', this.serial, ...args], { timeoutMs });
  }

  async shell(args: string[], timeoutMs?: number): Promise<string> {
    const res = await this.adb(['shell', ...args], timeoutMs);
    if (res.code !== 0) throw new Error(`adb shell ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim()}`);
    return res.stdout;
  }

  /** Polls `sys.boot_completed` until the device is ready. */
  async waitForBoot(timeoutSec: number, pollMs = 3000): Promise<void> {
    await this.adb(['wait-for-device'], timeoutSec * 1000);
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const res = await this.adb(['shell', 'getprop', 'sys.boot_completed']);
      if (res.code === 0 && res.stdout.trim() === '1') return;
      await sleep(pollMs);
    }
    throw new Error(`Emulator ${this.serial} did not finish booting within ${timeoutSec} s.`);
  }

  /** Demo mode, appearance and a fixed portrait orientation for tablets whose natural orientation is landscape. */
  async prepare(appearance: 'light' | 'dark', portrait: boolean): Promise<void> {
    for (const cmd of demoModeCommands()) await this.shell(cmd);
    await this.adb(['shell', 'cmd', 'uimode', 'night', appearance === 'dark' ? 'yes' : 'no']);
    if (portrait) {
      const size = parseWmSize(await this.shell(['wm', 'size']));
      await this.adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
      await this.adb(['shell', 'settings', 'put', 'system', 'user_rotation', size && size.width > size.height ? '1' : '0']);
    }
  }

  async install(apk: string): Promise<void> {
    const res = await this.adb(['install', '-r', '-t', '-g', apk], 600_000);
    if (res.code !== 0 || /Failure/.test(res.stdout)) throw new Error(`adb install failed: ${(res.stdout + res.stderr).trim().split('\n').slice(-3).join(' ')}`);
  }

  async setAppLocale(appId: string, tag: string): Promise<void> {
    const res = await this.adb(['shell', ...appLocaleArgs(appId, tag)]);
    if (res.code !== 0) log.warn(`Per-app language could not be set (${tag}); Android 13+ is required. The app may show the device language.`);
  }

  async resolveActivity(appId: string, configured?: string): Promise<string> {
    if (configured) return componentFor(appId, configured);
    const res = await this.adb(['shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', appId]);
    const found = res.code === 0 ? parseResolvedActivity(res.stdout, appId) : undefined;
    if (!found) throw new Error(`No launcher activity found for ${appId}; set capture.android.activity.`);
    return found;
  }

  async launch(component: string, extras: string[], url?: string): Promise<void> {
    const out = await this.shell(amStartArgs(component, extras, url), 60_000);
    if (/Error:/.test(out)) throw new Error(`am start failed (${component}): ${out.trim()}`);
  }

  /** `adb exec-out screencap -p` writes a PNG to stdout; it is captured as binary. */
  async screencap(out: string): Promise<void> {
    await ensureDir(dirname(out));
    const png = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(this.tools.adb, ['-s', this.serial, 'exec-out', 'screencap', '-p'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (d: Buffer) => chunks.push(d));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`screencap failed (${code})`))));
    });
    if (png.subarray(0, 4).toString('hex') !== '89504e47') throw new Error('screencap did not return a PNG.');
    await writeFile(out, png);
  }

  /** Starts `screenrecord` on the device; resolves once the clip is pulled to `out`. Max 180 s (Android limit). */
  async record(out: string, seconds: number, during: () => Promise<void>): Promise<void> {
    await ensureDir(dirname(out));
    const remote = `/sdcard/vitrin-${Date.now()}.mp4`;
    const rec = this.adb(['shell', 'screenrecord', '--time-limit', String(Math.min(180, Math.ceil(seconds))), remote], (seconds + 60) * 1000);
    await sleep(800);
    await during();
    const res = await rec;
    if (res.code !== 0) throw new Error(`screenrecord failed: ${res.stderr.trim()}`);
    await sleep(1000); // let the encoder finalise the file
    const pull = await this.adb(['pull', remote, out], 120_000);
    if (pull.code !== 0) throw new Error(`adb pull failed: ${pull.stderr.trim()}`);
    await this.adb(['shell', 'rm', '-f', remote]);
  }

  async shutdown(): Promise<void> {
    await this.adb(['shell', ...demoModeExit()]);
    await this.adb(['emu', 'kill']);
  }
}

/** Uses the configured AVD, or `Vitrin_<profile>`, creating it from the newest installed system image when missing. */
export async function ensureAvd(tools: AndroidTools, opts: { configured?: string; deviceProfile: string }, runner: Runner = exec): Promise<string> {
  const list = await runner(tools.emulator, ['-list-avds']);
  const avds = list.code === 0 ? parseAvdList(list.stdout) : [];
  if (opts.configured) {
    if (!avds.includes(opts.configured)) throw new Error(`AVD “${opts.configured}” not found (emulator -list-avds: ${avds.join(', ') || 'none'}). Fix capture.android.avds.`);
    return opts.configured;
  }
  const name = avdNameFor(opts.deviceProfile);
  if (avds.includes(name)) return name;
  const image = tools.sdkRoot ? pickSystemImage(installedSystemImages(tools.sdkRoot)) : undefined;
  if (!image) {
    throw new Error(`No Android system image found. Install one (sdkmanager "system-images;android-36;google_apis;${process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'}") or set capture.android.avds.`);
  }
  const res = await runner(tools.avdmanager, avdCreateArgs(name, image, opts.deviceProfile), { input: 'no\n' });
  if (res.code !== 0) throw new Error(`avdmanager create avd failed (${name}, ${opts.deviceProfile}): ${(res.stderr || res.stdout).trim().split('\n').slice(-2).join(' ')}`);
  log.ok(`Created AVD: ${name} (${opts.deviceProfile}, ${image})`);
  return name;
}

/** Boots an AVD in the background on a fixed port. The emulator keeps running until `AndroidDevice.shutdown`. */
export function startEmulator(tools: AndroidTools, avd: string, port: number, headless: boolean): void {
  const child = spawn(tools.emulator, emulatorArgs(avd, port, headless), { stdio: 'ignore', detached: true });
  child.unref();
}
