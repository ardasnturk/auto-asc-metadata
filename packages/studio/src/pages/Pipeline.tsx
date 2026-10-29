import { Fragment, useState } from 'react';
import { api, type Overview, type PipelineStage, type StageView } from '../api';
import { t, type UiKey } from '../i18n';
import { BlockerItem, blockerText, go, pendingDecisions, QuestionCard, STAGE_HINT, STAGE_PAGE, STAGE_TITLE, StageDecision, stageReason, statusClass, StatusPill } from '../status';
import { useBusy, useCli, useStudio } from '../store';
import { Button, Card, fmtDate, Modal, Pill } from '../ui';

/** The run at a glance: the next step first, then every stage with the status the server computed, and what waits for the user. */

/** The command each stage runs (mockups renders the screens into device frames); the upload is a page, not a command. */
const COMMAND: Partial<Record<PipelineStage, { command: string; args?: Record<string, unknown> }>> = {
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

/** The stages in three groups, so the list reads as a path rather than eleven commands. */
const GROUPS: Array<{ title: UiKey; stages: PipelineStage[] }> = [
  { title: 'groupPrepare', stages: ['analyze', 'research'] },
  { title: 'groupContent', stages: ['write', 'capture', 'mockups', 'design', 'video'] },
  { title: 'groupShip', stages: ['validate', 'review', 'upload', 'rank'] },
];

export function Pipeline({ openClaude }: { openClaude: () => void }) {
  const { state, run, toast } = useStudio();
  const busy = useBusy();
  const cli = useCli();
  const o = state.overview!;
  const [brief, setBrief] = useState<{ name: string; text: string } | undefined>();
  const runningCommand = state.job?.command;

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
  const runButton = (id: PipelineStage, opts: { size?: 'sm'; primary?: boolean; force?: boolean } = {}) => {
    const c = COMMAND[id]!;
    // A missing tool (ffmpeg) makes the run fail for sure; it unlocks by itself once the tool is installed.
    const missingTool = o.blockers.find((b) => b.stage === id && b.severity === 'error' && typeof b.params.install === 'string');
    return (
      <Button size={opts.size} kind={opts.primary ? 'primary' : opts.force ? 'ghost' : undefined} disabled={busy || Boolean(missingTool)} title={missingTool ? blockerText(missingTool) : cli(`vitrin ${c.command}`)} onClick={() => run(c.command, c.args, opts.force)}>
        {t(opts.force ? 'rerun' : 'run')}
      </Button>
    );
  };

  /** The single action a stage row offers; the rest sit behind “More”. */
  const primaryAction = (s: StageView) => {
    if (s.status === 'skipped') return null;
    if (s.status === 'needs-user' || s.id === 'upload')
      return (
        <Button size="sm" kind={s.status === 'needs-user' ? 'primary' : undefined} onClick={() => go(STAGE_PAGE[s.id])}>
          {t('goToPage')}
        </Button>
      );
    if (s.brief) return claudeButton(s.brief, 'sm');
    return runButton(s.id, { size: 'sm', primary: s.status !== 'done' && !s.optional });
  };

  // The next step's own blocker or decision already sits in the card at the top.
  const decisions = pendingDecisions(o).filter((d) => ('blocker' in d ? d.blocker.code !== o.next?.blocker : 'question' in d ? d.question.id !== o.next?.question : true));
  const byId = new Map(o.flow.map((s, i) => [s.id, { view: s, n: i + 1 }]));

  return (
    <div className="page">
      <header>
        <h2>{t('pipeline')}</h2>
        <p>{t('pipelineIntro')}</p>
      </header>
      <NextStepCard o={o} claudeButton={claudeButton} runButton={runButton} showBrief={showBrief} openClaude={openClaude} />
      <div className="pipeline-wrap">
        <div className="pipeline-grid">
          <div className="stage-list">
            {GROUPS.map((g) => (
              <Fragment key={g.title}>
                <div className="stage-group">{t(g.title)}</div>
                {g.stages.map((id) => {
                  const entry = byId.get(id);
                  if (!entry) return null;
                  const { view: s, n } = entry;
                  const running = Boolean(runningCommand && runningCommand === COMMAND[s.id]?.command);
                  const reason = stageReason(s, o);
                  return (
                    <div key={s.id} className={`stage ${running ? 'running' : statusClass(s.status)}`}>
                      <div className="num">{s.status === 'done' && !running ? '✓' : n}</div>
                      <div>
                        <div className="title">
                          <a href={`#/${STAGE_PAGE[s.id]}`} title={t('goToPage')}>
                            {t(STAGE_TITLE[s.id])}
                          </a>{' '}
                          {s.optional && <span className="dim small">· {t('optional')}</span>}
                        </div>
                        <div className="hint">{t(STAGE_HINT[s.id])}</div>
                        <div className="sub">
                          {running ? <Pill tone="accent">{t('running')}</Pill> : <StatusPill status={s.status} />}
                          {s.completedAt && s.status !== 'not-run' ? ` ${fmtDate(s.completedAt)}` : ''}
                          {reason ? ` · ${reason}` : ''}
                          {s.note ? ` · ${s.note}` : ''}
                        </div>
                      </div>
                      <div className="row">
                        {primaryAction(s)}
                        {COMMAND[s.id] && (
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
                              {(s.brief || s.status === 'needs-user') && runButton(s.id, { size: 'sm' })}
                              {runButton(s.id, { size: 'sm', force: true })}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="stack">
            <Card title={t('pendingDecisions')}>
              {decisions.length === 0 ? (
                <span className="dim">{t('noDecisions')}</span>
              ) : (
                <div className="stack">
                  {decisions.map((d) =>
                    'question' in d ? <QuestionCard key={d.key} question={d.question} openClaude={openClaude} /> : 'blocker' in d ? <BlockerItem key={d.key} blocker={d.blocker} openClaude={openClaude} /> : <StageDecision key={d.key} stage={d.stage} o={o} />,
                  )}
                </div>
              )}
            </Card>
            <Summary o={o} />
          </div>
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

/** One sentence and one button: what to do now. */
function NextStepCard({
  o,
  claudeButton,
  runButton,
  showBrief,
  openClaude,
}: {
  o: Overview;
  claudeButton: (name: string) => React.ReactNode;
  runButton: (id: PipelineStage, opts?: { primary?: boolean }) => React.ReactNode;
  showBrief: (name: string) => void;
  openClaude: () => void;
}) {
  const next = o.next;
  if (!next)
    return o.flow.length ? (
      <Card className="next-step" title={t('nextStep')}>
        <div>{t('allDone')}</div>
      </Card>
    ) : null;
  const view = o.flow.find((s) => s.id === next.stage);
  const blocker = next.blocker ? o.blockers.find((b) => b.code === next.blocker) : undefined;
  const reason = view ? stageReason(view, o) : '';
  const question = next.question ? o.questions.find((q) => q.id === next.question) : undefined;
  let body: React.ReactNode;
  if (next.action === 'answer' && question) {
    body = <QuestionCard question={question} openClaude={openClaude} />;
  } else if ((next.action === 'fix' || next.action === 'decide') && blocker) {
    body = (
      <>
        {next.action === 'fix' && <div className="dim">{t('nextFixFirst')}</div>}
        <BlockerItem blocker={blocker} primary openClaude={openClaude} />
      </>
    );
  } else if (next.action === 'claude' && view?.brief) {
    body = (
      <>
        <div>{t('nextClaude', { stage: t(STAGE_TITLE[next.stage]) })}</div>
        <div className="row">
          {claudeButton(view.brief)}
          <Button onClick={() => showBrief(view.brief!)}>{t('brief')}</Button>
        </div>
      </>
    );
  } else if (next.action === 'approve' || next.action === 'upload' || next.action === 'finalize') {
    const text = next.action === 'finalize' ? t('nextFinalize') : reason || t(next.action === 'upload' ? 'decisionUpload' : 'nextApprove');
    body = (
      <>
        <div>{text}</div>
        <div className="row">
          <Button kind="primary" onClick={() => go(STAGE_PAGE[next.stage])}>
            {t(next.action === 'approve' ? 'openReview' : 'openUpload')}
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div>{reason || t('nextRun', { stage: t(STAGE_TITLE[next.stage]) })}</div>
        <div className="row">{COMMAND[next.stage] ? runButton(next.stage, { primary: true }) : null}</div>
      </>
    );
  }
  return (
    <Card className="next-step" title={t('nextStep')}>
      <div className="stack">
        <div className="next-title">{t(STAGE_TITLE[next.stage])}</div>
        {body}
      </div>
    </Card>
  );
}

/** What exists for the selected store languages, with what is missing in red. */
function Summary({ o }: { o: Overview }) {
  const cfg = o.config;
  if (!cfg) return null;
  const skipped = (id: PipelineStage) => o.flow.find((s) => s.id === id)?.status === 'skipped';
  const extra = o.listing.filter((l) => !cfg.locales.includes(l));
  const perLocale = (files: Record<string, unknown[]>) =>
    cfg.locales.map((l, i) => (
      <Fragment key={l}>
        {i > 0 && ' · '}
        <span className={files[l]?.length ? '' : 'text-err'}>
          {l}: {files[l]?.length ?? 0}
        </span>
      </Fragment>
    ));
  const up = o.approval?.upload && o.approval.upload.overallHash === o.approval.overallHash ? o.approval.upload : undefined;
  return (
    <Card title={t('summary')}>
      <dl className="kv">
        <dt>{t('storeLocales')}</dt>
        <dd>
          {cfg.locales.join(', ')} {!cfg.locales.includes(cfg.primaryLocale) && <span className="text-err">({t('primaryLocaleIs', { locale: cfg.primaryLocale })})</span>}
        </dd>
        <dt>{t('storeText')}</dt>
        <dd>
          {cfg.locales.map((l, i) => (
            <Fragment key={l}>
              {i > 0 && ' · '}
              <span className={o.listing.includes(l) ? '' : 'text-err'}>
                {l} {o.listing.includes(l) ? '✓' : `✗ ${t('missing')}`}
              </span>
            </Fragment>
          ))}
          {extra.length > 0 && <div className="dim small">{t('notSelectedExtra', { n: extra.length })}</div>}
        </dd>
        {!skipped('design') && (
          <>
            <dt>{t('screenshots')}</dt>
            <dd>{perLocale(o.screenshots)}</dd>
          </>
        )}
        {!skipped('video') && (
          <>
            <dt>{t('previews')}</dt>
            <dd>{perLocale(o.previews)}</dd>
          </>
        )}
        <dt>{t('validationLabel')}</dt>
        <dd>
          {o.validation ? (
            <>
              <Pill tone={o.validation.ok ? 'ok' : 'err'}>{o.validation.ok ? t('validationOk') : t('validationErrors', { n: o.validation.counts.error })}</Pill>
              {o.validation.counts.warning > 0 && <span className="dim small"> {t('warningsN', { n: o.validation.counts.warning })}</span>}
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt>{t('approvalLabel')}</dt>
        <dd>
          {o.approval?.valid ? (
            <Pill tone="ok">{fmtDate(o.approval.approvedAt)}</Pill>
          ) : o.approval && o.approval.status === 'approved' ? (
            <span className="text-err">{t('approvalInvalid', { reason: stageReason({ id: 'review', status: 'blocked', reason: o.approval.problem }, o) })}</span>
          ) : (
            <Pill>{t('notApproved')}</Pill>
          )}
        </dd>
        <dt>{t('upload')}</dt>
        <dd>{up ? <Pill tone={up.readBack === 'ok' ? 'ok' : 'err'}>{fmtDate(up.uploadedAt)}</Pill> : <span className="dim">{t('notUploaded')}</span>}</dd>
      </dl>
    </Card>
  );
}
