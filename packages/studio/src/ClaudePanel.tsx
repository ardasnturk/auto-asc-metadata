import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ClaudeEvent, type ClaudeRun, type PipelineStage } from './api';
import { t } from './i18n';
import { QuestionCard, STAGE_TITLE } from './status';
import { useBusy, useStudio } from './store';
import { Button, Pill } from './ui';

/**
 * The Claude drawer: runs the user's Claude Code headless on a brief or a message and shows what it does. One
 * conversation per Studio session; "new conversation" forgets it without sending anything. Questions Claude leaves
 * (metadata/questions.json) are answered here or on Akış.
 */

type RunInfo = Pick<ClaudeRun, 'id' | 'prompt' | 'label'>;
type Event = ClaudeEvent & { runId: string };

const info = (r: ClaudeRun): RunInfo => ({ id: r.id, prompt: r.prompt, label: r.label });

export function ClaudePanel({ onClose }: { onClose: () => void }) {
  const { state, toast, setClaudeEvents } = useStudio();
  const busy = useBusy();
  const [prompt, setPrompt] = useState('');
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const o = state.overview;
  const available = o?.claude.available ?? false;

  // The server keeps every run of this session (a reload keeps them). Read it on open and whenever a run ends, so
  // events that streamed in while the panel was opening are never lost.
  useEffect(() => {
    if (state.claudeRunning) return;
    void api.claude().then((c) => {
      setRuns(c.runs.map(info));
      setClaudeEvents(() => c.runs.flatMap((r) => r.events.map((e) => ({ ...e, runId: r.id }))));
    });
  }, [state.claudeRunning, setClaudeEvents]);

  // A run started from Akış or a question card: fetch its label so it shows up here too.
  const unknown = state.claudeEvents.some((e) => !runs.some((r) => r.id === e.runId));
  useEffect(() => {
    if (unknown) void api.claude().then((c) => setRuns(c.runs.map(info)));
  }, [unknown]);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.claudeEvents.length, o?.questions.length]);

  const start = useCallback(
    async (body: { prompt?: string; stage?: string }) => {
      try {
        const r = await api.askClaude(body);
        setRuns((h) => [...h, { id: r.id, prompt: body.prompt ?? '', label: body.stage ? { kind: 'brief', stage: body.stage } : { kind: 'prompt', text: body.prompt ?? '' } }]);
        setPrompt('');
      } catch (err) {
        toast((err as Error).message, 'err');
      }
    },
    [toast],
  );

  const newConversation = async () => {
    try {
      await api.resetClaude();
      setRuns([]);
      setClaudeEvents(() => []);
      toast(t('conversationCleared'), 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };

  const send = () => {
    if (prompt.trim() && !busy) void start({ prompt: prompt.trim() });
  };

  const byRun = new Map<string, Event[]>();
  for (const e of state.claudeEvents) byRun.set(e.runId, [...(byRun.get(e.runId) ?? []), e]);
  const briefs = o?.briefs ?? [];
  const questions = o?.questions ?? [];

  return (
    <>
      <div className="head">
        <h3>✳ {t('claude')}</h3>
        {state.claudeRunning ? (
          <Pill tone="accent">
            <span className="dot busy" /> {t('running')}
          </Pill>
        ) : (
          <Pill>{t('idle')}</Pill>
        )}
        <Button size="sm" kind="ghost" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="claude-log" ref={ref}>
        {!available && <div className="msg error">{t('claudeMissing')}</div>}
        {available && runs.length === 0 && (
          <div className="msg result stack">
            <div>{t('claudeIdle')}</div>
            {briefs.length > 0 && (
              <>
                <div className="dim small">{t('pendingBriefs')}</div>
                <div className="row wrap">
                  {briefs.map((b) => (
                    <Button key={b.name} size="sm" kind="primary" disabled={busy} onClick={() => start({ stage: b.name })}>
                      ✳ {briefTitle(b.name)}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {runs.map((r) => (
          <Run key={r.id} run={r} events={byRun.get(r.id) ?? []} root={o?.root ?? ''} />
        ))}
        {!state.claudeRunning && questions.map((q) => <QuestionCard key={q.id} question={q} />)}
      </div>
      <div className="compose">
        <textarea
          className="input"
          rows={3}
          placeholder={t('claudePlaceholder')}
          value={prompt}
          disabled={!available}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <div className="row">
          {state.claudeRunning ? (
            <Button kind="danger" size="sm" onClick={() => api.cancelClaude().catch((err) => toast((err as Error).message, 'err'))}>
              {t('stop')}
            </Button>
          ) : (
            <Button kind="primary" size="sm" disabled={!available || !prompt.trim() || busy} onClick={send}>
              {t('send')} ⌘↩
            </Button>
          )}
          <span className="grow" />
          <Button size="sm" kind="ghost" disabled={state.claudeRunning || runs.length === 0} onClick={newConversation}>
            {t('newConversation')}
          </Button>
        </div>
      </div>
    </>
  );
}

/** Brief names are stage names, except the capture stage's brief (screens.md). */
function briefTitle(name: string): string {
  const stage = (name === 'screens' ? 'capture' : name) as PipelineStage;
  return STAGE_TITLE[stage] ? t(STAGE_TITLE[stage]) : name;
}

function RunTitle({ run }: { run: RunInfo }) {
  const l = run.label;
  if (l?.kind === 'brief')
    return (
      <div className="msg user">
        ✳ {t('runBrief', { stage: briefTitle(l.stage) })}
        {l.extra ? ` — ${l.extra}` : ''}
      </div>
    );
  if (l?.kind === 'answer')
    return (
      <div className="msg user">
        <div className="dim small">{l.question}</div>
        {t('runAnswer', { answer: l.answer })}
      </div>
    );
  return <div className="msg user">{l?.kind === 'prompt' ? l.text : run.prompt}</div>;
}

const WRITES = new Set(['Write', 'Edit', 'MultiEdit']);

/** The page where a written file shows up, so the summary can link to it. */
function pageFor(rel: string): string | undefined {
  if (rel === 'vitrin.config.yaml' || rel === 'metadata/app_profile.json') return 'setup';
  if (rel.startsWith('metadata/listing/') || rel.startsWith('metadata/research/') || rel === 'metadata/cpp-suggestions.json') return 'metadata';
  if (rel.startsWith('metadata/screens/')) return 'screens';
  if (rel === 'metadata/shots.json' || rel === 'metadata/art-direction.json' || rel.startsWith('metadata/designs/')) return 'design';
  if (rel === 'metadata/video-plan.json') return 'video';
  if (rel === 'metadata/questions.json') return 'pipeline';
  return undefined;
}

function Run({ run, events, root }: { run: RunInfo; events: Event[]; root: string }) {
  // One summary per run: the last result (an extra result after the first one is a continuation of the same run).
  const results = events.filter((e): e is Extract<Event, { type: 'result' }> => e.type === 'result');
  const last = results[results.length - 1];
  const files = [
    ...new Set(
      events
        .filter((e): e is Extract<Event, { type: 'tool' }> => e.type === 'tool' && WRITES.has(e.name) && Boolean(e.summary))
        .map((e) => (root && e.summary.startsWith(`${root}/`) ? e.summary.slice(root.length + 1) : e.summary)),
    ),
  ];
  return (
    <>
      <RunTitle run={run} />
      {events.map((e, i) => {
        switch (e.type) {
          case 'text':
            return (
              <div key={i} className="msg assistant">
                {e.text}
              </div>
            );
          case 'tool':
            return (
              <div key={i} className="msg tool">
                <b>{e.name}</b> {e.summary}
              </div>
            );
          case 'error':
            return (
              <div key={i} className="msg error">
                {e.text}
              </div>
            );
          default:
            return null;
        }
      })}
      {last && (
        <div className={`msg result ${last.ok ? '' : 'error'}`}>
          {files.length > 0 && (
            <div className="written">
              <div className="dim small">{t('writtenFiles')}</div>
              {files.map((f) => {
                const page = pageFor(f);
                return (
                  <div key={f} className="mono small">
                    {page ? <a href={`#/${page}`}>{f}</a> : f}
                  </div>
                );
              })}
            </div>
          )}
          <div>
            {last.ok ? '✓' : '✗'}
            {last.durationMs ? ` · ${Math.round(last.durationMs / 1000)}s` : ''}
            {last.costUsd !== undefined ? ` · ${t('runCost', { cost: last.costUsd.toFixed(2) })}` : ''}
            {!last.ok && last.text ? ` · ${last.text}` : ''}
          </div>
        </div>
      )}
    </>
  );
}
