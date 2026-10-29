import { useState } from 'react';
import { api, type PipelineStage, type StageView } from '../api';
import { t } from '../i18n';
import { BlockerItem, STAGE_TITLE, stageReason, statusClass, StatusPill } from '../status';
import { useBusy, useStudio } from '../store';
import { Button, Card, fmtDate, Modal, Pill } from '../ui';

/** The stage board: the next step first, then every stage with the status the server computed, and what blocks the run. */

/** The command each stage runs (mockups renders the screens into device frames). */
const COMMAND: Record<PipelineStage, { command: string; args?: Record<string, unknown> }> = {
  analyze: { command: 'analyze' },
  research: { command: 'research' },
  write: { command: 'write' },
  capture: { command: 'capture' },
  mockups: { command: 'mockups', args: { screens: true } },
  design: { command: 'design' },
  video: { command: 'video' },
  validate: { command: 'validate' },
  review: { command: 'review' },
  rank: { command: 'rank' },
};

const go = (route: string) => (location.hash = `/${route}`);

export function Pipeline({ openClaude }: { openClaude: () => void }) {
  const { state, run, toast } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const [brief, setBrief] = useState<{ name: string; text: string } | undefined>();
  const runningStage = state.job?.command;

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
  const claudeButton = (name: string, size?: 'sm') => (
    <Button size={size} kind="primary" disabled={busy || !o.claude.available} title={o.claude.available ? t('askClaudeHint') : t('claudeMissing')} onClick={() => askClaude(name)}>
      ✳ {t('askClaude')}
    </Button>
  );

  /** The single action a stage row offers; the rest sit behind “More”. */
  const primaryAction = (s: StageView) => {
    if (s.brief) return claudeButton(s.brief, 'sm');
    if (s.id === 'review' && s.status === 'needs-user')
      return (
        <Button size="sm" kind="primary" onClick={() => go('review')}>
          {t('openReview')}
        </Button>
      );
    if (s.status === 'skipped') return null;
    const c = COMMAND[s.id];
    return (
      <Button size="sm" kind={s.status === 'done' || s.optional ? undefined : 'primary'} disabled={busy} title={`vitrin ${c.command}`} onClick={() => run(c.command, c.args)}>
        {t('run')}
      </Button>
    );
  };

  const next = o.next;
  const nextBlocker = next?.blocker ? o.blockers.find((b) => b.code === next.blocker) : undefined;
  const nextView = o.flow.find((s) => s.id === next?.stage);
  const attention = o.blockers.filter((b) => b !== nextBlocker);

  return (
    <div className="page">
      <header>
        <h2>{t('pipeline')}</h2>
        <p>{t('pipelineIntro')}</p>
      </header>
      {next && (
        <Card className="next-step" title={t('nextStep')}>
          <div className="stack">
            <div className="next-title">{t(STAGE_TITLE[next.stage])}</div>
            {next.action === 'fix' && nextBlocker ? (
              <>
                <div className="dim">{t('nextFixFirst')}</div>
                <BlockerItem blocker={nextBlocker} primary />
              </>
            ) : next.action === 'claude' && nextView?.brief ? (
              <>
                <div>{t('nextClaude', { stage: t(STAGE_TITLE[next.stage]) })}</div>
                <div className="row">
                  {claudeButton(nextView.brief)}
                  <Button onClick={() => showBrief(nextView.brief!)}>{t('brief')}</Button>
                </div>
              </>
            ) : next.action === 'approve' ? (
              <>
                <div>{nextView?.reason ? stageReason(nextView, o) : t('nextApprove')}</div>
                <div className="row">
                  <Button kind="primary" onClick={() => go('review')}>
                    {t('openReview')}
                  </Button>
                </div>
              </>
            ) : next.action === 'upload' ? (
              <>
                <div>{t('nextUpload')}</div>
                <div className="row">
                  <Button kind="primary" onClick={() => go('upload')}>
                    {t('openUpload')}
                  </Button>
                </div>
              </>
            ) : (
              next.stage !== 'upload' && (
                <>
                  <div>{nextView && stageReason(nextView, o) ? stageReason(nextView, o) : t('nextRun', { stage: t(STAGE_TITLE[next.stage]) })}</div>
                  <div className="row">
                    <Button kind="primary" disabled={busy} onClick={() => run(COMMAND[next.stage as PipelineStage].command, COMMAND[next.stage as PipelineStage].args)}>
                      {t('run')}
                    </Button>
                  </div>
                </>
              )
            )}
          </div>
        </Card>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <div className="stage-list">
          {o.flow.map((s, i) => {
            const running = runningStage === COMMAND[s.id].command;
            const reason = stageReason(s, o);
            return (
              <div key={s.id} className={`stage ${running ? 'running' : statusClass(s.status)}`}>
                <div className="num">{i + 1}</div>
                <div>
                  <div className="title">
                    {t(STAGE_TITLE[s.id])} {s.optional && <span className="dim small">· {t('optional')}</span>}
                  </div>
                  <div className="sub">
                    {running ? t('running') : <StatusPill status={s.status} />}
                    {s.completedAt && s.status !== 'not-run' ? ` ${fmtDate(s.completedAt)}` : ''}
                    {reason ? ` · ${reason}` : ''}
                    {s.note ? ` · ${s.note}` : ''}
                  </div>
                </div>
                <div className="row">
                  {primaryAction(s)}
                  <details className="more">
                    <summary className="btn sm ghost" title={t('moreActions')}>
                      ⋯
                    </summary>
                    <div className="menu">
                      {s.brief && (
                        <Button size="sm" kind="ghost" onClick={() => showBrief(s.brief!)}>
                          {t('brief')}
                        </Button>
                      )}
                      {s.brief && (
                        <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(COMMAND[s.id].command, COMMAND[s.id].args)}>
                          {t('run')}
                        </Button>
                      )}
                      <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(COMMAND[s.id].command, COMMAND[s.id].args, true)}>
                        {t('rerun')}
                      </Button>
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
        </div>
        <div className="stack">
          <Card title={t('attention')}>
            {attention.length === 0 ? (
              <span className="dim">{t('allClear')}</span>
            ) : (
              <div className="stack">
                {attention.map((b) => (
                  <BlockerItem key={b.code} blocker={b} />
                ))}
              </div>
            )}
          </Card>
          <Card title={t('status')}>
            <dl className="kv">
              <dt>{t('storeLocales')}</dt>
              <dd>{o.config?.locales.join(', ')}</dd>
              <dt>{t('metadata')}</dt>
              <dd>{o.listing.length ? o.listing.join(', ') : '—'}</dd>
              <dt>{t('screenshots')}</dt>
              <dd>{Object.entries(o.screenshots).map(([l, f]) => `${l}: ${f.length}`).join(' · ') || '—'}</dd>
              <dt>{t('previews')}</dt>
              <dd>{Object.entries(o.previews).map(([l, f]) => `${l}: ${f.length}`).join(' · ') || '—'}</dd>
              <dt>{t('stageValidate')}</dt>
              <dd>{o.validation ? <Pill tone={o.validation.ok ? 'ok' : 'err'}>{o.validation.ok ? t('validationOk') : t('validationErrors', { n: o.validation.counts.error })}</Pill> : '—'}</dd>
              <dt>{t('approved')}</dt>
              <dd>
                {o.approval?.valid ? (
                  <Pill tone="ok">{fmtDate(o.approval.approvedAt)}</Pill>
                ) : o.approval && o.approval.status === 'approved' ? (
                  <span className="text-err">{t('approvalInvalid', { reason: stageReason({ id: 'review', status: 'blocked', reason: o.approval.problem }, o) })}</span>
                ) : (
                  <Pill>{t('notApproved')}</Pill>
                )}
              </dd>
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
