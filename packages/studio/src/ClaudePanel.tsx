import { useEffect, useRef, useState } from 'react';
import { api, type ClaudeEvent } from './api';
import { t } from './i18n';
import { useStudio } from './store';
import { Button, Pill, Select } from './ui';

/**
 * The Claude drawer: runs the user's Claude Code headless on a brief or a free-form instruction and shows what it
 * does (text, tool calls, result). One conversation per Studio session; "new conversation" drops the session.
 */
export function ClaudePanel({ onClose }: { onClose: () => void }) {
  const { state, toast, setClaudeEvents } = useStudio();
  const [prompt, setPrompt] = useState('');
  const [stage, setStage] = useState('');
  const [history, setHistory] = useState<Array<{ runId: string; prompt: string }>>([]);
  const ref = useRef<HTMLDivElement>(null);
  const o = state.overview;
  const available = o?.claude.available ?? false;

  useEffect(() => {
    // Earlier runs of this server session (a reload keeps them).
    void api.claude().then((c) => {
      setHistory(c.runs.map((r) => ({ runId: r.id, prompt: r.prompt })));
      setClaudeEvents(() => c.runs.flatMap((r) => r.events.map((e) => ({ ...e, runId: r.id }))));
    });
  }, [setClaudeEvents]);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.claudeEvents.length]);

  const start = async (body: { prompt?: string; stage?: string; extra?: string; fresh?: boolean }) => {
    try {
      const r = await api.askClaude(body);
      setHistory((h) => [...h, { runId: r.id, prompt: body.prompt ?? `${t('brief')}: ${body.stage}${body.extra ? ` — ${body.extra}` : ''}` }]);
      setPrompt('');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };

  const briefs = o?.briefs ?? [];
  const runs = new Map<string, Array<ClaudeEvent & { runId: string }>>();
  for (const e of state.claudeEvents) runs.set(e.runId, [...(runs.get(e.runId) ?? []), e]);

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
        <Button size="sm" kind="ghost" onClick={() => start({ prompt: '', fresh: true }).catch(() => undefined)} disabled title={t('newConversation')} style={{ display: 'none' }}>
          ↺
        </Button>
        <Button size="sm" kind="ghost" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="claude-log" ref={ref}>
        {!available && <div className="msg error">{t('claudeMissing')}</div>}
        {available && history.length === 0 && <div className="msg result">{t('claudeIdle')}</div>}
        {history.map((h) => (
          <Run key={h.runId} prompt={h.prompt} events={runs.get(h.runId) ?? []} />
        ))}
      </div>
      <div className="compose">
        {briefs.length > 0 && (
          <div className="row">
            <Select value={stage} onChange={setStage} allowEmpty={`${t('brief')}…`} options={briefs.map((b) => ({ value: b.name, label: `${b.name}.md` }))} />
            <Button kind="primary" size="sm" disabled={!available || !stage || state.claudeRunning || Boolean(state.job)} onClick={() => start({ stage, extra: prompt || undefined })}>
              {t('askClaude')}
            </Button>
          </div>
        )}
        <textarea
          className="input"
          rows={3}
          placeholder={stage ? t('extraInstructions') : t('claudePlaceholder')}
          value={prompt}
          disabled={!available}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim() && !state.claudeRunning) void start(stage ? { stage, extra: prompt } : { prompt });
          }}
        />
        <div className="row">
          {state.claudeRunning ? (
            <Button kind="danger" size="sm" onClick={() => api.cancelClaude().catch((err) => toast((err as Error).message, 'err'))}>
              {t('stop')}
            </Button>
          ) : (
            <Button kind="primary" size="sm" disabled={!available || !prompt.trim() || Boolean(state.job)} onClick={() => start(stage ? { stage, extra: prompt } : { prompt })}>
              {t('send')} ⌘↩
            </Button>
          )}
          <span className="grow" />
          <Button
            size="sm"
            kind="ghost"
            disabled={state.claudeRunning || history.length === 0}
            onClick={() => {
              setHistory([]);
              setClaudeEvents(() => []);
              void start({ prompt: prompt.trim() || 'Hello. Say in one sentence what you see in this project.', fresh: true });
            }}
          >
            {t('newConversation')}
          </Button>
        </div>
      </div>
    </>
  );
}

function Run({ prompt, events }: { prompt: string; events: Array<ClaudeEvent & { runId: string }> }) {
  return (
    <>
      <div className="msg user">{prompt}</div>
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
          case 'result':
            return (
              <div key={i} className="msg result">
                {e.ok ? '✓' : '✗'} {e.turns ? `${e.turns} turns` : ''} {e.durationMs ? `· ${Math.round(e.durationMs / 1000)}s` : ''} {e.costUsd !== undefined ? `· $${e.costUsd.toFixed(2)}` : ''}
                {!e.ok && e.text ? ` · ${e.text}` : ''}
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
    </>
  );
}
