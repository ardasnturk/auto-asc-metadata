/** Types and calls for the Studio server (packages/cli/src/studio). Kept in sync by hand; the server is the source. */

export interface RenderedFile {
  path: string;
  name: string;
  bytes: number;
}

export interface CaptureScreen {
  id: string;
  source?: string[];
  launchArgs?: string[];
  waitMs?: number;
  url?: string;
}

export interface PlatformChoice {
  platform: string;
  label: string;
  detected: boolean;
  selected: boolean;
  evidence: Array<{ path: string; line?: number; note?: string }>;
  targets: Record<string, string[]>;
}

export interface PlatformsReport {
  app: string;
  kind: string;
  platforms: PlatformChoice[];
  assets: Array<{ asset: string; label: string; selected: boolean }>;
  formats: Array<{ target: string; label: string; platform: string; kind: string; size: string; required: boolean; selected: boolean }>;
  locales: Array<{ locale: string; selected: boolean; detected: boolean }>;
  samples: { locale: string; target: string; family: string };
  language: string | null;
  uploader: string | null;
  capture: string;
  selection: { platforms?: string[]; assets?: string[]; targets?: string[] };
}

export interface JobSummary {
  id: string;
  command: string;
  args: Record<string, unknown>;
  status: 'running' | 'ok' | 'failed' | 'needs-input';
  startedAt: string;
  endedAt?: string;
  code?: number;
  message?: string;
  details?: string[];
  result?: unknown;
}

export interface LogLine {
  jobId?: string;
  level: 'info' | 'step' | 'ok' | 'warn' | 'error' | 'dim' | 'result' | 'raw';
  text: string;
}

export interface Job extends JobSummary {
  lines: LogLine[];
}

export type ClaudeEvent =
  | { type: 'init'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'result'; ok: boolean; text: string; costUsd?: number; durationMs?: number; turns?: number }
  | { type: 'error'; text: string }
  | { type: 'exit'; code: number };

export interface ClaudeRun {
  id: string;
  prompt: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  events: ClaudeEvent[];
}

export interface Overview {
  version: string;
  root: string;
  initialized: boolean;
  configError?: string;
  app?: { name: string; bundleId?: string; icon?: string; kind: string; platforms: string[]; version?: string };
  config?: {
    locales: string[];
    primaryLocale: string;
    language: string | null;
    uploader: string | null;
    capture: string;
    screens: CaptureScreen[];
    selection: { platforms?: string[]; assets?: string[]; targets?: string[] };
    video: { enabled: boolean; loops: boolean };
    seeds: string[] | Record<string, string[]>;
  };
  platforms?: PlatformsReport;
  stages: Record<string, { completedAt: string; status: string; note?: string } | undefined>;
  files: Record<string, boolean>;
  listing: string[];
  playListing: string[];
  briefs: Array<{ name: string; path: string; modifiedAt: string }>;
  validation?: { ok: boolean; counts: { error: number; warning: number; info: number }; generatedAt?: string };
  approval?: { status: string; approvedAt: string; via: string; overallHash: string; upload?: { uploadedAt: string; overallHash: string; readBack: string; differences: string[] }; finalized?: { at: string; mode: string }; rejections: number };
  raw: Record<string, Record<string, RenderedFile[]>>;
  screenshots: Record<string, RenderedFile[]>;
  previews: Record<string, RenderedFile[]>;
  creatives: Record<string, RenderedFile[]>;
  videoStyles: Record<string, RenderedFile[]>;
  cpp: Record<string, Record<string, RenderedFile[]>>;
  samples?: { styles: string[]; contactSheet?: string; storePreview?: string };
  mockups?: { index?: string; screens: RenderedFile[] };
  tools: { asc: string | null; fastlane: string | null; ruby: string | null; bundler: string | null; brew?: string | null; claude: string | null; ffmpeg: string | null };
  missingKeys: string[];
  enums: { presets: string[]; emphasis: string[]; archetypes: string[]; framings: string[]; scenes: string[]; videoStyles: string[]; transitions: string[]; badgeTypes: string[] };
  job: JobSummary | null;
  claude: { available: boolean; running: boolean; sessionId: string | null };
  remotion: { running: boolean; url: string | null; available: boolean };
}

export interface ReviewState {
  overallHash: string;
  approval: { ok: boolean; reason?: string; added: string[]; removed: string[]; changed: string[] };
  summary: string[];
  items: Array<{ id: string; kind: string; store: string; platform: string; locale?: string; target?: string; label: string }>;
  report: string;
}

export interface EditableFile {
  path: string;
  kind: 'json' | 'text' | 'yaml' | 'markdown';
  readOnly: boolean;
  exists: boolean;
  text: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: string[] = [],
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(typeof data.error === 'string' ? data.error : `${res.status} ${res.statusText}`, res.status, Array.isArray(data.issues) ? (data.issues as string[]) : [], data);
  return data as T;
}

export const api = {
  overview: () => request<Overview>('GET', '/api/overview'),
  jobs: () => request<JobSummary[]>('GET', '/api/jobs'),
  job: (id: string) => request<Job>('GET', `/api/jobs/${id}`),
  run: (command: string, args: Record<string, unknown> = {}, force = false) => request<JobSummary>('POST', '/api/jobs', { command, args, force }),
  file: (path: string) => request<EditableFile>('GET', `/api/file?path=${encodeURIComponent(path)}`),
  save: (path: string, text: string) => request<{ ok: true; path: string }>('PUT', '/api/file', { path, text }),
  claude: () => request<{ available: boolean; running: string | null; sessionId: string | null; runs: ClaudeRun[] }>('GET', '/api/claude'),
  askClaude: (body: { prompt?: string; stage?: string; extra?: string; fresh?: boolean }) => request<{ id: string }>('POST', '/api/claude', body),
  cancelClaude: () => request<{ cancelled: boolean }>('POST', '/api/claude/cancel', {}),
  review: () => request<ReviewState>('GET', '/api/review'),
  approve: (overallHash: string) => request<{ ok: true; overallHash: string; approvedAt: string }>('POST', '/api/approve', { overallHash }),
  reject: (overallHash: string, rejections: Array<{ item: string; comment: string }>) => request<{ ok: true; rejected: number }>('POST', '/api/reject', { overallHash, rejections }),
  remotion: () => request<{ running: boolean; url: string | null; log: string[] }>('GET', '/api/remotion'),
  startRemotion: (locale?: string) => request<{ running: boolean }>('POST', '/api/remotion', { locale }),
  stopRemotion: () => request<{ running: boolean }>('DELETE', '/api/remotion'),
  open: (path: string, reveal = false) => request<{ ok: true }>('POST', '/api/open', { path, reveal }),
};

/** URL of a file under the app root (metadata/…), served by the Studio. */
export const fileUrl = (path: string, bust?: string | number) => `/files/${path.split('/').map(encodeURIComponent).join('/')}${bust ? `?v=${encodeURIComponent(String(bust))}` : ''}`;

export type StudioEvent =
  | { event: 'hello'; data: { job: JobSummary | null; claude: { id: string } | null; remotion: { running: boolean; url?: string } } }
  | { event: 'log'; data: LogLine }
  | { event: 'job'; data: JobSummary }
  | { event: 'claude'; data: ClaudeEvent & { runId: string } }
  | { event: 'changed'; data: { paths: string[]; count: number } }
  | { event: 'remotion'; data: { running: boolean; url?: string; line?: string } };

/** Subscribes to the server's event stream; reconnects on its own. */
export function subscribe(onEvent: (e: StudioEvent) => void, onState?: (connected: boolean) => void): () => void {
  let es: EventSource | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    es = new EventSource('/api/events');
    for (const name of ['hello', 'log', 'job', 'claude', 'changed', 'remotion'] as const) {
      es.addEventListener(name, (ev) => {
        try {
          onEvent({ event: name, data: JSON.parse((ev as MessageEvent).data) } as StudioEvent);
        } catch {
          /* ignore malformed events */
        }
      });
    }
    es.onopen = () => onState?.(true);
    es.onerror = () => {
      onState?.(false);
      es?.close();
      if (!closed) retry = setTimeout(connect, 2000);
    };
  };
  connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    es?.close();
  };
}
