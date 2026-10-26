import { ensureDir, exec, log, run } from '@vitrin/core';
import type { Platform } from '@vitrin/schemas';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Runner } from './build.js';

/** Platforms that run in an Xcode simulator. macOS apps run natively (see the Mac section below). */
export type SimPlatform = Extract<Platform, 'ios' | 'watchos' | 'tvos' | 'visionos'>;

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
  deviceTypeIdentifier?: string;
}

export interface SimRuntime {
  identifier: string;
  name: string;
  version: string;
  isAvailable: boolean;
  platform?: string;
  supportedDeviceTypes?: Array<{ name: string; identifier: string }>;
}

export interface SimList {
  devices: Record<string, SimDevice[]>;
  runtimes: SimRuntime[];
  devicetypes: Array<{ name: string; identifier: string }>;
}

export async function simList(runner: Runner = exec): Promise<SimList> {
  const res = await runner('xcrun', ['simctl', 'list', '-j']);
  if (res.code !== 0) throw new Error(`simctl list failed: ${res.stderr.trim()}`);
  return JSON.parse(res.stdout) as SimList;
}

/**
 * True when a simctl runtime belongs to the platform. Newer simctl versions report `platform`
 * ("iOS", "watchOS", "tvOS", "xrOS"/"visionOS"); older ones only the name and identifier.
 */
export function runtimeMatches(runtime: Pick<SimRuntime, 'name' | 'identifier' | 'platform'>, platform: SimPlatform): boolean {
  const hay = `${runtime.platform ?? ''} ${runtime.name} ${runtime.identifier}`;
  switch (platform) {
    case 'ios':
      return /(^|[\s.])iOS\b/.test(hay);
    case 'watchos':
      return /watchOS/.test(hay);
    case 'tvos':
      return /tvOS/.test(hay);
    case 'visionos':
      return /visionOS|xrOS/.test(hay);
  }
}

/** Picks the device type and the newest available runtime of the platform that supports it. */
export function pickRuntime(list: SimList, deviceTypeName: string, platform: SimPlatform): { type: { name: string; identifier: string }; runtime: SimRuntime } {
  const type = list.devicetypes.find((t) => t.name === deviceTypeName);
  if (!type) throw new Error(`Simulator device type not found: “${deviceTypeName}”. Download a suitable runtime from Xcode > Settings > Components or change it in capture.simulators.`);
  const runtime = list.runtimes
    .filter((r) => r.isAvailable && runtimeMatches(r, platform) && (!r.supportedDeviceTypes || r.supportedDeviceTypes.some((d) => d.identifier === type.identifier)))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!runtime) throw new Error(`No suitable ${PLATFORM_NAME[platform]} runtime for “${deviceTypeName}” (xcodebuild -downloadPlatform ${PLATFORM_NAME[platform]}).`);
  return { type, runtime };
}

const PLATFORM_NAME: Record<SimPlatform, string> = { ios: 'iOS', watchos: 'watchOS', tvos: 'tvOS', visionos: 'visionOS' };

/**
 * Returns a dedicated "Vitrin · <type>" simulator on the newest runtime of the platform that supports the device type,
 * creating it if needed, so status-bar overrides never touch the user's own simulators.
 */
export async function ensureSimulator(deviceTypeName: string, platform: SimPlatform = 'ios', runner: Runner = exec): Promise<{ udid: string; name: string; runtime: string }> {
  const list = await simList(runner);
  const { type, runtime } = pickRuntime(list, deviceTypeName, platform);
  const name = `Vitrin · ${deviceTypeName}`;
  const existing = (list.devices[runtime.identifier] ?? []).find((d) => d.name === name && d.isAvailable);
  if (existing) return { udid: existing.udid, name, runtime: runtime.name };
  const created = await runner('xcrun', ['simctl', 'create', name, type.identifier, runtime.identifier]);
  if (created.code !== 0) throw new Error(`simctl create failed (${name}): ${created.stderr.trim()}`);
  log.ok(`Created simulator: ${name} (${runtime.name})`);
  return { udid: created.stdout.trim(), name, runtime: runtime.name };
}

/**
 * Apple's marketing status bar: 9:41, full battery, full signal. iOS supports every flag; watchOS only the time
 * (the others are ignored there); tvOS and visionOS have no status bar override.
 */
export function statusBarArgs(udid: string, platform: SimPlatform): string[] | undefined {
  if (platform === 'tvos' || platform === 'visionos') return undefined;
  if (platform === 'watchos') return ['simctl', 'status_bar', udid, 'override', '--time', '9:41'];
  return [
    'simctl', 'status_bar', udid, 'override',
    '--time', '9:41',
    '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3',
    '--cellularMode', 'active', '--cellularBars', '4', '--operatorName', '',
    '--batteryState', 'charged', '--batteryLevel', '100',
  ];
}

export async function bootAndPrepare(udid: string, appearance: 'light' | 'dark', platform: SimPlatform = 'ios'): Promise<void> {
  await exec('xcrun', ['simctl', 'boot', udid]); // already booted → non-zero, fine
  await run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeoutMs: 300_000 });
  await exec('xcrun', ['simctl', 'ui', udid, 'appearance', appearance]);
  const bar = statusBarArgs(udid, platform);
  if (bar) {
    // Required on iOS; best effort elsewhere.
    if (platform === 'ios') await run('xcrun', bar);
    else await exec('xcrun', bar);
  }
}

/**
 * System language and region (status bar date on iPad, keyboards, system sheets) follow the global defaults,
 * not the app's -AppleLanguages argument, so set them and reboot the simulator.
 */
export async function setSystemLocale(udid: string, locale: string, storefront: string, appearance: 'light' | 'dark', platform: SimPlatform = 'ios'): Promise<void> {
  const [, lang, , appleLocale] = languageArgs(locale, storefront);
  const langCode = lang!.replace(/[()]/g, '');
  await run('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', '-g', 'AppleLanguages', '-array', langCode]);
  await run('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', '-g', 'AppleLocale', '-string', appleLocale!]);
  await exec('xcrun', ['simctl', 'shutdown', udid]);
  await bootAndPrepare(udid, appearance, platform);
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
  await recordProcess(spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', out], { stdio: 'ignore' }), out, seconds);
}

async function recordProcess(child: ChildProcess, out: string, seconds: number): Promise<void> {
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

// ---------------------------------------------------------------- macOS (native Mac app or Mac Catalyst)

/**
 * Prints the on-screen windows of one process as JSON: `[{ "id": 123, "x": 0, "y": 25, "w": 1440, "h": 900, "title": "…" }]`.
 * Run with `xcrun swift <file> <pid>`; CGWindowList needs no Screen Recording permission for ids and bounds.
 */
export const WINDOW_LIST_SWIFT = `import CoreGraphics
import Foundation
let pid = Int(CommandLine.arguments[1]) ?? 0
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var out: [[String: Any]] = []
for w in info where (w[kCGWindowOwnerPID as String] as? Int) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
  let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
  out.append(["id": w[kCGWindowNumber as String] as? Int ?? 0, "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0, "title": w[kCGWindowName as String] as? String ?? ""])
}
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
`;

export interface MacWindow {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

/** The app's main window: the largest normal window (sheets and panels are smaller). */
export function pickMainWindow(windows: MacWindow[]): MacWindow | undefined {
  return [...windows].filter((w) => w.id > 0 && w.w > 100 && w.h > 100).sort((a, b) => b.w * b.h - a.w * a.h)[0];
}

/** `screencapture` for one window: no shadow (-o), no sound (-x). */
export function screencaptureArgs(windowId: number, out: string): string[] {
  return ['-l', String(windowId), '-o', '-x', '-t', 'png', out];
}

/** `screencapture` video of a screen rectangle for `seconds` (window ids are not supported for video). */
export function screenRecordArgs(win: Pick<MacWindow, 'x' | 'y' | 'w' | 'h'>, seconds: number, out: string): string[] {
  return ['-v', '-V', String(seconds), '-x', `-R${Math.round(win.x)},${Math.round(win.y)},${Math.round(win.w)},${Math.round(win.h)}`, out];
}

/** AppleScript that moves and resizes the app's front window to the 16:10 point size (needs Accessibility permission). */
export function windowResizeScript(pid: number, width: number, height: number): string {
  return `tell application "System Events" to tell (first process whose unix id is ${pid})
  set position of window 1 to {40, 60}
  set size of window 1 to {${width}, ${height}}
end tell`;
}

/** Launch arguments for a Mac app: the demo flags, language, and dark mode via the argument domain. */
export function macLaunchArgs(args: string[], locale: string, storefront: string, appearance: 'light' | 'dark'): string[] {
  return [...args, ...languageArgs(locale, storefront), ...(appearance === 'dark' ? ['-AppleInterfaceStyle', 'Dark'] : [])];
}

/** Executable inside a .app bundle (CFBundleExecutable, else the bundle name). */
export async function macExecutable(appPath: string): Promise<string> {
  const res = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', join(appPath, 'Contents', 'Info.plist')]);
  const name = res.code === 0 && res.stdout.trim() ? res.stdout.trim() : appPath.split('/').pop()!.replace(/\.app$/, '');
  return join(appPath, 'Contents', 'MacOS', name);
}

export class MacApp {
  private child?: ChildProcess;
  private scriptPath: string;

  constructor(
    private readonly appPath: string,
    private readonly cacheDir: string,
    private readonly size: { width: number; height: number },
  ) {
    this.scriptPath = join(cacheDir, 'vitrin-windows.swift');
  }

  /** Starts the app (terminating a previous instance) and waits for its main window. */
  async launch(args: string[], waitMs: number): Promise<MacWindow> {
    await this.quit();
    const bin = await macExecutable(this.appPath);
    this.child = spawn(bin, args, { stdio: 'ignore', detached: false });
    const pid = this.child.pid;
    if (!pid) throw new Error(`Could not launch ${this.appPath}.`);
    await sleep(Math.max(1500, waitMs / 2));
    const resize = await exec('osascript', ['-e', windowResizeScript(pid, this.size.width, this.size.height)]);
    if (resize.code !== 0) log.warn('Could not resize the Mac window (grant Accessibility to your terminal); the capture is scaled to the target size instead.');
    await sleep(Math.max(500, waitMs / 2));
    const win = pickMainWindow(await this.windows(pid));
    if (!win) throw new Error(`No window found for ${this.appPath} (pid ${pid}).`);
    return win;
  }

  private async windows(pid: number): Promise<MacWindow[]> {
    await ensureDir(this.cacheDir);
    await writeFile(this.scriptPath, WINDOW_LIST_SWIFT);
    const res = await run('xcrun', ['swift', this.scriptPath, String(pid)], { timeoutMs: 120_000 });
    return JSON.parse(res.stdout.trim() || '[]') as MacWindow[];
  }

  /** Captures the window and scales it to exactly the target pixels (cover, centred). */
  async capture(win: MacWindow, out: string, target: { width: number; height: number }): Promise<void> {
    await ensureDir(dirname(out));
    const tmp = `${out}.window.png`;
    await run('screencapture', screencaptureArgs(win.id, tmp));
    const sharp = (await import('sharp')).default;
    await sharp(await readFile(tmp)).resize(target.width, target.height, { fit: 'cover', position: 'centre' }).png().toFile(out);
    await rm(tmp, { force: true });
  }

  /** Records the window rectangle, then converts the .mov to H.264 .mp4. */
  async record(win: MacWindow, out: string, seconds: number): Promise<void> {
    await ensureDir(dirname(out));
    const mov = out.replace(/\.mp4$/, '.mov');
    await run('screencapture', screenRecordArgs(win, seconds, mov), { timeoutMs: (seconds + 30) * 1000 });
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', mov, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', out]);
    await rm(mov, { force: true });
  }

  async quit(): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      const closed = new Promise((r) => this.child!.once('close', r));
      this.child.kill('SIGTERM');
      await Promise.race([closed, sleep(5000)]);
    }
    this.child = undefined;
  }
}
