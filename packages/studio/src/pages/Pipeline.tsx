import { useState } from 'react';
import { api } from '../api';
import { t, type UiKey } from '../i18n';
import { useBusy, useStudio } from '../store';
import { Button, Card, fmtDate, Modal, Pill } from '../ui';

/** The stage board: what ran, what waits for input, and the briefs Claude can take from here. */

interface StageDef {
  id: string;
  command: string;
  args?: Record<string, unknown>;
  title: UiKey;
  /** state.json key (mockups has none; capture covers it). */
  state?: string;
  /** Brief this stage leaves when Claude input is needed. */
  brief?: string;
}

const STAGES: StageDef[] = [
  { id: 'analyze', command: 'analyze', title: 'stageAnalyze', state: 'analyze', brief: 'analyze' },
  { id: 'research', command: 'research', title: 'stageResearch', state: 'research' },
  { id: 'write', command: 'write', title: 'stageWrite', state: 'write', brief: 'write' },
  { id: 'capture', command: 'capture', title: 'stageCapture', state: 'capture', brief: 'screens' },
  { id: 'mockups', command: 'mockups', args: { screens: true }, title: 'stageMockups' },
  { id: 'design', command: 'design', title: 'stageDesign', state: 'design', brief: 'design' },
  { id: 'video', command: 'video', title: 'stageVideo', state: 'video', brief: 'video' },
  { id: 'validate', command: 'validate', title: 'stageValidate', state: 'validate' },
  { id: 'review', command: 'review', title: 'stageReview', state: 'review', brief: 'review' },
  { id: 'rank', command: 'rank', title: 'stageRank' },
];

export function Pipeline({ openClaude }: { openClaude: () => void }) {
  const { state, run, toast } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const [brief, setBrief] = useState<{ name: string; text: string } | undefined>();
  const briefNames = new Set(o.briefs.map((b) => b.name));
  const lastJob = (id: string) => (state.job?.command === id ? state.job : undefined);

  const showBrief = async (name: string) => {
    try {
      const f = await api.file(`metadata/briefs/${name}.md`);
      setBrief({ name, text: f.text });
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };
  const askClaude = async (name: string) => {
    try {
      await api.askClaude({ stage: name });
      openClaude();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };

  return (
    <div className="page">
      <header>
        <h2>{t('pipeline')}</h2>
        <p>{t('pipelineIntro')}</p>
      </header>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <div className="stage-list">
          {STAGES.map((s, i) => {
            const rec = s.state ? o.stages[s.state] : undefined;
            const running = lastJob(s.command);
            const hasBrief = s.brief && briefNames.has(s.brief);
            const cls = running ? 'running' : hasBrief ? 'needs-input' : rec ? rec.status : '';
            return (
              <div key={s.id} className={`stage ${cls}`}>
                <div className="num">{i + 1}</div>
                <div>
                  <div className="title">
                    {t(s.title)} <span className="dim mono small">vitrin {s.command}</span>
                  </div>
                  <div className="sub">
                    {running ? t('running') : hasBrief ? t('needsInput') : rec ? `${rec.status === 'ok' ? t('done') : rec.status} · ${fmtDate(rec.completedAt)}` : s.state ? t('stale') : ''}
                    {rec?.note ? ` · ${rec.note}` : ''}
                  </div>
                </div>
                <div className="row">
                  {hasBrief && (
                    <>
                      <Button size="sm" onClick={() => showBrief(s.brief!)}>
                        {t('brief')}
                      </Button>
                      <Button size="sm" kind="primary" disabled={busy || !o.claude.available} title={o.claude.available ? t('askClaudeHint') : t('claudeMissing')} onClick={() => askClaude(s.brief!)}>
                        ✳ {t('askClaude')}
                      </Button>
                    </>
                  )}
                  <Button size="sm" disabled={busy} onClick={() => run(s.command, s.args)}>
                    {t('run')}
                  </Button>
                  {s.state && (
                    <Button size="sm" kind="ghost" disabled={busy} title={t('rerun')} onClick={() => run(s.command, s.args, true)}>
                      ↻
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="stack">
          <Card title={t('briefs')}>
            {o.briefs.length === 0 ? (
              <span className="dim">{t('nothingYet')}</span>
            ) : (
              <div className="stack">
                {o.briefs.map((b) => (
                  <div key={b.name} className="row">
                    <Button size="sm" kind="ghost" onClick={() => showBrief(b.name)} className="grow" style={{ justifyContent: 'flex-start' }}>
                      <code>{b.name}.md</code>
                    </Button>
                    <span className="dim small">{fmtDate(b.modifiedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title={t('status')}>
            <dl className="kv">
              <dt>{t('platforms')}</dt>
              <dd>{(o.config?.selection.platforms ?? o.app?.platforms ?? []).join(', ') || '—'}</dd>
              <dt>{t('content')}</dt>
              <dd>{o.config?.selection.assets?.join(', ') ?? 'all'}</dd>
              <dt>{t('storeLocales')}</dt>
              <dd>{o.config?.locales.join(', ')}</dd>
              <dt>{t('metadata')}</dt>
              <dd>{o.listing.length ? o.listing.join(', ') : '—'}</dd>
              <dt>{t('screenshots')}</dt>
              <dd>{Object.entries(o.screenshots).map(([l, f]) => `${l}: ${f.length}`).join(' · ') || '—'}</dd>
              <dt>{t('previews')}</dt>
              <dd>{Object.entries(o.previews).map(([l, f]) => `${l}: ${f.length}`).join(' · ') || '—'}</dd>
              <dt>{t('review')}</dt>
              <dd>{o.validation ? <Pill tone={o.validation.ok ? 'ok' : 'err'}>{o.validation.ok ? 'validation ok' : `${o.validation.counts.error} errors`}</Pill> : '—'}</dd>
              <dt>{t('approved')}</dt>
              <dd>{o.approval ? <Pill tone={o.approval.status === 'approved' ? 'ok' : 'warn'}>{o.approval.status} · {fmtDate(o.approval.approvedAt)}</Pill> : <Pill>{t('notApproved')}</Pill>}</dd>
            </dl>
          </Card>
        </div>
      </div>
      {brief && (
        <Modal
          title={`${brief.name}.md`}
          onClose={() => setBrief(undefined)}
          wide
          actions={
            <Button kind="primary" size="sm" disabled={busy || !o.claude.available} onClick={() => askClaude(brief.name).then(() => setBrief(undefined))}>
              ✳ {t('askClaude')}
            </Button>
          }
        >
          <pre className="markdown">{brief.text}</pre>
        </Modal>
      )}
    </div>
  );
}
