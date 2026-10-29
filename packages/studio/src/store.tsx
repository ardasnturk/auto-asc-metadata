import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, subscribe, type ClaudeEvent, type JobSummary, type LogLine, type Overview } from './api';
import { setLanguage } from './i18n';

/** Shared Studio state: the project overview, the running job and its log, Claude's events and toasts. */

export interface Toast {
  id: number;
  kind: 'ok' | 'err' | 'info';
  text: string;
}

export interface StudioState {
  overview?: Overview;
  loadError?: string;
  connected: boolean;
  job: JobSummary | null;
  /** Console lines of this session (all jobs), capped. */
  logs: LogLine[];
  claudeEvents: Array<ClaudeEvent & { runId: string }>;
  claudeRunning: boolean;
  remotion: { running: boolean; url?: string };
  /** Bumps whenever metadata/ changed on disk, so editors reload what they are not editing. */
  changedTick: number;
  toasts: Toast[];
  /** The last job that ended (for the shell's summary toast). */
  finishedJob?: JobSummary;
  /** Shows CLI commands, file paths, JSON editors and Claude's tool calls; remembered in this browser. */
  devMode: boolean;
}

interface StudioApi {
  state: StudioState;
  refresh(): Promise<void>;
  run(command: string, args?: Record<string, unknown>, force?: boolean): Promise<JobSummary | undefined>;
  toast(text: string, kind?: Toast['kind']): void;
  dismiss(id: number): void;
  setClaudeEvents(fn: (prev: StudioState['claudeEvents']) => StudioState['claudeEvents']): void;
  clearLogs(): void;
  setDevMode(on: boolean): void;
}

const DEV_KEY = 'vitrin.studio.devMode';
function readDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_KEY) === '1';
  } catch {
    return false;
  }
}

const Ctx = createContext<StudioApi | undefined>(undefined);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>({ connected: false, job: null, logs: [], claudeEvents: [], claudeRunning: false, remotion: { running: false }, changedTick: 0, toasts: [], devMode: readDevMode() });
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setState((s) => ({ ...s, toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'err' ? 9000 : 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const overview = await api.overview();
      setLanguage(overview.config?.language);
      setState((s) => ({ ...s, overview, loadError: undefined, job: overview.job, claudeRunning: overview.claude.running, remotion: { running: overview.remotion.running, url: overview.remotion.url ?? undefined } }));
    } catch (err) {
      setState((s) => ({ ...s, loadError: (err as Error).message }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    let changedTimer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe(
      (e) => {
        if (e.event === 'hello') setState((s) => ({ ...s, job: e.data.job, claudeRunning: Boolean(e.data.claude), remotion: { running: e.data.remotion.running, url: e.data.remotion.url } }));
        else if (e.event === 'log') setState((s) => ({ ...s, logs: [...s.logs.slice(-2500), e.data] }));
        else if (e.event === 'job') {
          setState((s) => ({ ...s, job: e.data.status === 'running' ? e.data : null, ...(e.data.status === 'running' ? {} : { finishedJob: e.data }) }));
          if (e.data.status !== 'running') void refresh();
        } else if (e.event === 'claude') {
          setState((s) => ({ ...s, claudeEvents: [...s.claudeEvents.slice(-1500), e.data], claudeRunning: e.data.type !== 'exit' }));
          if (e.data.type === 'exit') void refresh();
        } else if (e.event === 'changed') {
          if (changedTimer) clearTimeout(changedTimer);
          changedTimer = setTimeout(() => {
            setState((s) => ({ ...s, changedTick: s.changedTick + 1 }));
            void refresh();
          }, 400);
        } else if (e.event === 'remotion') {
          setState((s) => ({ ...s, remotion: { running: e.data.running, url: e.data.url ?? (e.data.running ? s.remotion.url : undefined) } }));
        }
      },
      (connected) => setState((s) => ({ ...s, connected })),
    );
    return off;
  }, [refresh]);

  const run = useCallback(
    async (command: string, args: Record<string, unknown> = {}, force = false) => {
      try {
        const job = await api.run(command, args, force);
        setState((s) => ({ ...s, job, logs: [...s.logs, { level: 'step', text: `▸ vitrin ${command}${Object.keys(args).length ? ' ' + JSON.stringify(args) : ''}${force ? ' --force' : ''}` }] }));
        return job;
      } catch (err) {
        toast((err as Error).message, 'err');
        return undefined;
      }
    },
    [toast],
  );

  const value = useMemo<StudioApi>(
    () => ({
      state,
      refresh,
      run,
      toast,
      dismiss: (id) => setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })),
      setClaudeEvents: (fn) => setState((s) => ({ ...s, claudeEvents: fn(s.claudeEvents) })),
      clearLogs: () => setState((s) => ({ ...s, logs: [] })),
      setDevMode: (on) => {
        try {
          localStorage.setItem(DEV_KEY, on ? '1' : '0');
        } catch {
          /* private window: the choice lasts for this page only */
        }
        setState((s) => ({ ...s, devMode: on }));
      },
    }),
    [state, refresh, run, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudio(): StudioApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio outside StudioProvider');
  return v;
}

/** Developer mode: CLI commands, file paths, JSON editors and tool calls are shown only when it is on. */
export function useDev(): boolean {
  return useStudio().state.devMode;
}

/** A tooltip naming the CLI command behind a button, in developer mode only. */
export function useCli(): (command: string) => string | undefined {
  const dev = useDev();
  return (command) => (dev ? command : undefined);
}

/** The job is busy when a stage or Claude runs: editors stay usable, run buttons wait. */
export function useBusy(): boolean {
  const { state } = useStudio();
  return Boolean(state.job) || state.claudeRunning;
}

export interface FileState<T> {
  loading: boolean;
  exists: boolean;
  readOnly: boolean;
  text: string;
  data: T | undefined;
  dirty: boolean;
  error?: string;
  issues: string[];
  setData(next: T): void;
  setText(next: string): void;
  save(): Promise<boolean>;
  reload(): Promise<void>;
}

/** Loads one editable file (JSON parsed when it is JSON); saving validates on the server. */
export function useFile<T = unknown>(path: string | undefined, opts: { json?: boolean } = { json: true }): FileState<T> {
  const { state, toast } = useStudio();
  const [loading, setLoading] = useState(Boolean(path));
  const [exists, setExists] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [text, setTextRaw] = useState('');
  const [data, setDataRaw] = useState<T | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [issues, setIssues] = useState<string[]>([]);
  const dirtyRef = useRef(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const f = await api.file(path);
      setExists(f.exists);
      setReadOnly(f.readOnly);
      setTextRaw(f.text);
      if (opts.json && f.text.trim()) {
        try {
          setDataRaw(JSON.parse(f.text) as T);
          setError(undefined);
        } catch (err) {
          setDataRaw(undefined);
          setError(`Invalid JSON: ${(err as Error).message}`);
        }
      } else {
        setDataRaw(undefined);
        setError(undefined);
      }
      setDirty(false);
      dirtyRef.current = false;
      setIssues([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, opts.json]);

  useEffect(() => {
    void reload();
  }, [reload]);
  // Pick up what Claude or a stage wrote, unless the user is mid-edit.
  useEffect(() => {
    if (!dirtyRef.current) void reload();
  }, [state.changedTick, reload]);

  const setData = useCallback((next: T) => {
    setDataRaw(next);
    setTextRaw(JSON.stringify(next, null, 2) + '\n');
    setDirty(true);
    dirtyRef.current = true;
  }, []);
  const setText = useCallback(
    (next: string) => {
      setTextRaw(next);
      if (opts.json) {
        try {
          setDataRaw(JSON.parse(next) as T);
          setError(undefined);
        } catch (err) {
          setError(`Invalid JSON: ${(err as Error).message}`);
        }
      }
      setDirty(true);
      dirtyRef.current = true;
    },
    [opts.json],
  );
  const save = useCallback(async () => {
    if (!path) return false;
    try {
      await api.save(path, text);
      setDirty(false);
      dirtyRef.current = false;
      setExists(true);
      setIssues([]);
      setError(undefined);
      toast(`${path.split('/').pop()} saved`, 'ok');
      return true;
    } catch (err) {
      const e = err as ApiError;
      setError(e.message);
      setIssues(e instanceof ApiError ? e.issues : []);
      toast(e.message, 'err');
      return false;
    }
  }, [path, text, toast]);

  return { loading, exists, readOnly, text, data, dirty, error, issues, setData, setText, save, reload };
}
