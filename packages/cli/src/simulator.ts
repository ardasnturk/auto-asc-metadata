import { ensureDir, exec, existsSync, log, run } from '@vitrin/core';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
  deviceTypeIdentifier?: string;
}

interface SimList {
  devices: Record<string, SimDevice[]>;
  runtimes: Array<{ identifier: string; name: string; version: string; isAvailable: boolean; platform?: string; supportedDeviceTypes?: Array<{ name: string; identifier: string }> }>;
  devicetypes: Array<{ name: string; identifier: string }>;
}

export async function simList(): Promise<SimList> {
  const res = await run('xcrun', ['simctl', 'list', '-j']);
  return JSON.parse(res.stdout) as SimList;
}

/**
 * Returns a dedicated "Vitrin · <type>" simulator on the newest iOS runtime that supports the device type,
 * creating it if needed, so status-bar overrides never touch the user's own simulators.
 */
export async function ensureSimulator(deviceTypeName: string): Promise<{ udid: string; name: string; runtime: string }> {
  const list = await simList();
  const type = list.devicetypes.find((t) => t.name === deviceTypeName);
  if (!type) throw new Error(`Simulator device type not found: “${deviceTypeName}”. Download a suitable runtime from Xcode > Settings > Components or change it in capture.simulators.`);
  const runtimes = list.runtimes
    .filter((r) => r.isAvailable && /iOS/.test(r.name) && (!r.supportedDeviceTypes || r.supportedDeviceTypes.some((d) => d.identifier === type.identifier)))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const runtime = runtimes[0];
  if (!runtime) throw new Error(`No suitable iOS runtime for “${deviceTypeName}”.`);
  const name = `Vitrin · ${deviceTypeName}`;
  const existing = (list.devices[runtime.identifier] ?? []).find((d) => d.name === name && d.isAvailable);
  if (existing) return { udid: existing.udid, name, runtime: runtime.name };
  const created = await run('xcrun', ['simctl', 'create', name, type.identifier, runtime.identifier]);
  log.ok(`Created simulator: ${name} (${runtime.name})`);
  return { udid: created.stdout.trim(), name, runtime: runtime.name };
}

export async function bootAndPrepare(udid: string, appearance: 'light' | 'dark'): Promise<void> {
  await exec('xcrun', ['simctl', 'boot', udid]); // already booted → non-zero, fine
  await run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeoutMs: 300_000 });
  await exec('xcrun', ['simctl', 'ui', udid, 'appearance', appearance]);
  // Apple's marketing convention: 9:41, full battery, full signal.
  await run('xcrun', [
    'simctl', 'status_bar', udid, 'override',
    '--time', '9:41',
    '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3',
    '--cellularMode', 'active', '--cellularBars', '4', '--operatorName', '',
    '--batteryState', 'charged', '--batteryLevel', '100',
  ]);
}

/**
 * System language and region (status bar date on iPad, keyboards, system sheets) follow the global defaults,
 * not the app's -AppleLanguages argument, so set them and reboot the simulator.
 */
export async function setSystemLocale(udid: string, locale: string, storefront: string, appearance: 'light' | 'dark'): Promise<void> {
  const [, lang, , appleLocale] = languageArgs(locale, storefront);
  const langCode = lang!.replace(/[()]/g, '');
  await run('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', '-g', 'AppleLanguages', '-array', langCode]);
  await run('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', '-g', 'AppleLocale', '-string', appleLocale!]);
  await exec('xcrun', ['simctl', 'shutdown', udid]);
  await bootAndPrepare(udid, appearance);
}

/** True when a capture is (almost) a single flat colour — e.g. a folded iPhone Duo or a screen that never rendered. */
export async function isBlankCapture(file: string): Promise<boolean> {
  const sharp = (await import('sharp')).default;
  const stats = await sharp(file).stats();
  return stats.channels.slice(0, 3).every((c) => c.stdev < 4);
}

export async function shutdown(udid: string): Promise<void> {
  await exec('xcrun', ['simctl', 'status_bar', udid, 'clear']);
  await exec('xcrun', ['simctl', 'shutdown', udid]);
}

/** Builds the app for the simulator and returns the .app path. */
export async function buildForSimulator(opts: { root: string; project?: string; workspace?: string; scheme: string; configuration: string; derivedData: string }): Promise<string> {
  const args = [
    ...(opts.workspace ? ['-workspace', join(opts.root, opts.workspace)] : ['-project', join(opts.root, opts.project!)]),
    '-scheme', opts.scheme,
    '-configuration', opts.configuration,
    '-destination', 'generic/platform=iOS Simulator',
    '-derivedDataPath', opts.derivedData,
    'build',
    'CODE_SIGNING_ALLOWED=NO',
    'COMPILER_INDEX_STORE_ENABLE=NO',
  ];
  log.step(`xcodebuild ${opts.scheme} (${opts.configuration}, iOS Simulator)…`);
  const res = await exec('xcodebuild', args, { cwd: opts.root, timeoutMs: 30 * 60_000 });
  if (res.code !== 0) {
    const errors = (res.stdout + res.stderr).split('\n').filter((l) => /error:/.test(l)).slice(0, 15).join('\n');
    throw new Error(`xcodebuild failed:\n${errors || res.stderr.slice(-3000)}`);
  }
  const products = join(opts.derivedData, 'Build', 'Products', `${opts.configuration}-iphonesimulator`);
  const apps = existsSync(products) ? (await readdir(products)).filter((f) => f.endsWith('.app')) : [];
  const app = apps.find((a) => a === `${opts.scheme}.app`) ?? apps[0];
  if (!app) throw new Error(`Built .app not found (${products}).`);
  return join(products, app);
}

/** ASC locale → simulator language/locale launch arguments. */
export function languageArgs(locale: string, storefront: string): string[] {
  const lang = locale === 'no' ? 'nb' : locale;
  const region = (locale.split('-')[1] && locale.split('-')[1]!.length === 2 ? locale.split('-')[1]! : storefront).toUpperCase();
  const base = lang.split('-')[0]!;
  return ['-AppleLanguages', `(${lang})`, '-AppleLocale', `${base}_${region}`];
}

/** Launch with retries: right after a reboot SpringBoard may refuse launches for a few seconds. */
export async function launch(udid: string, bundleId: string, args: string[], attempts = 4): Promise<void> {
  for (let i = 1; ; i++) {
    const res = await exec('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, bundleId, ...args]);
    if (res.code === 0) return;
    if (i >= attempts) throw new Error(`simctl launch failed (${bundleId}): ${res.stderr.trim().split('\n').slice(-2).join(' ')}`);
    await sleep(2500 * i);
  }
}

export async function screenshot(udid: string, out: string): Promise<void> {
  await ensureDir(dirname(out));
  await run('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', out]);
}

/** Records the simulator screen (H.264) for `seconds`, stopping with SIGINT so the file is finalised. */
export async function record(udid: string, out: string, seconds: number): Promise<void> {
  await ensureDir(dirname(out));
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', out], { stdio: 'ignore' });
  // Attach listeners first: if recording fails immediately, `close` must not be missed.
  let exited = false;
  const closed = new Promise<void>((resolve) => {
    child.on('close', () => ((exited = true), resolve()));
    child.on('error', () => ((exited = true), resolve()));
  });
  await Promise.race([closed, sleep(seconds * 1000)]);
  if (exited) throw new Error(`Screen recording did not start (${out}).`);
  child.kill('SIGINT');
  await closed;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
