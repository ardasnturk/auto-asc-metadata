import { useEffect, useState, type ReactNode } from 'react';
import { api, type JobSummary } from '../api';
import { t } from '../i18n';
import { CopyCode, go, stageReason } from '../status';
import { useBusy, useCli, useStudio } from '../store';
import { Button, Card, Check, fmtDate, Modal, Pill, Radio } from '../ui';
import { DoctorChecks } from './Setup';

/**
 * The upload as a checklist: uploader → keys (names only) → approved content → dry-run plan → the upload after the
 * user's explicit confirmation. Each step says what it waits for and how to fix it; read-back, finalize and submit follow.
 */
export function Upload() {
  const { state, run } = useStudio();
  const busy = useBusy();
  const cli = useCli();
  const o = state.overview!;
  const [flags, setFlags] = useState({ creatives: false, cpp: false, events: false, experiment: false, skipScreenshots: false });
  const [doctor, setDoctor] = useState<JobSummary | undefined>();
  const [planJob, setPlanJob] = useState<JobSummary | undefined>();
  const [planText, setPlanText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [bundle, setBundle] = useState('');
  const [deleteResearch, setDeleteResearch] = useState<boolean | undefined>();

  // Track the doctor and upload jobs this page started, and read the plan text from the finished dry run.
  useEffect(() => {
    const j = state.job;
    if (!j) return;
    if (j.command === 'doctor') setDoctor(j);
    if (j.command === 'upload') setPlanJob(j);
  }, [state.job]);
  useEffect(() => {
    if (state.job) return;
    if (doctor?.status === 'running') void api.job(doctor.id).then(setDoctor);
    if (planJob?.status === 'running')
      void api.job(planJob.id).then((j) => {
        setPlanJob(j);
        setPlanText(j.lines.filter((l) => l.level !== 'raw' || l.text.trim()).map((l) => l.text).join('\n'));
      });
  }, [state.job, doctor, planJob]);

  const uploader = o.config?.uploader ?? null;
  const tool = uploader === 'asc' ? o.tools.asc : uploader ? o.tools.fastlane : null;
  const uploaderOk = Boolean(uploader && tool);
  const keysOk = o.missingKeys.length === 0;
  const approved = Boolean(o.approval?.valid);
  const planOk = planJob?.status === 'ok';
  const uploaded = o.approval?.upload;
  const appName = o.app?.name ?? '';
  const waiting = [!uploaderOk && t('uploadStepUploader'), !keysOk && t('uploadStepKeys'), !approved && t('uploadStepApproval')].filter(Boolean) as string[];
  const canUpload = waiting.length === 0 && !busy;
  const flagArgs = { creatives: flags.creatives, cpp: flags.cpp, events: flags.events, experiment: flags.experiment || undefined, skipScreenshots: flags.skipScreenshots };
  const approvalProblem = o.approval?.status === 'approved' && !approved ? stageReason({ id: 'review', status: 'blocked', reason: o.approval.problem }, o) : undefined;

  return (
    <div className="page upload">
      <header>
        <h2>{t('upload')}</h2>
        <p>{t('uploadIntro')}</p>
      </header>
      <div className="checklist">
        <Step n={1} ok={uploaderOk} title={t('uploadStepUploader')}>
          <div className="stack tight">
            <Radio name="upload-uploader" checked={uploader === 'asc'} disabled={busy} onChange={() => run('select', { uploader: 'asc' })} hint={t('uploaderAscHint')}>
              asc CLI {o.tools.asc ? <Pill tone="ok">{`${t('installed')} ${o.tools.asc}`}</Pill> : <Pill tone="warn">{t('missing')}</Pill>}
            </Radio>
            <Radio name="upload-uploader" checked={uploader === 'deliver'} disabled={busy} onChange={() => run('select', { uploader: 'deliver' })} hint={t('uploaderDeliverHint')}>
              fastlane deliver {o.tools.fastlane ? <Pill tone="ok">{`${t('installed')} ${o.tools.fastlane}`}</Pill> : <Pill tone="warn">{t('missing')}</Pill>}
            </Radio>
          </div>
          {!uploader && <div className="text-err small">{t('blockerUploaderUnset')}</div>}
          {uploader && !tool && <CopyCode text={uploader === 'asc' ? 'brew install asc' : 'bundle install'} />}
        </Step>

        <Step
          n={2}
          ok={keysOk}
          title={t('uploadStepKeys')}
          actions={
            <Button size="sm" disabled={busy} title={cli('vitrin doctor')} onClick={() => run('doctor', {})}>
              {t('doctor')}
            </Button>
          }
        >
          {keysOk ? (
            <div className="small">{t('keysOk')}</div>
          ) : (
            <div className="stack tight">
              <div className="small">
                {t('keysMissing')}{' '}
                {o.missingKeys.map((k) => (
                  <code key={k} style={{ marginRight: 6 }}>
                    {k}
                  </code>
                ))}
              </div>
              <div className="row">
                <Button size="sm" kind="ghost" onClick={() => go('setup')}>
                  {t('howToKeys')} →
                </Button>
              </div>
            </div>
          )}
          {doctor?.result ? <DoctorChecks result={doctor.result as { checks: Array<{ id: string; title: string; status: string; detail?: string; fix?: string }> }} /> : null}
        </Step>

        <Step n={3} ok={approved} title={t('uploadStepApproval')}>
          {approved ? (
            <div className="small">
              {t('approved')} · {fmtDate(o.approval?.approvedAt)}
            </div>
          ) : (
            <div className="stack tight">
              <div className={`small ${approvalProblem ? 'text-err' : ''}`}>{approvalProblem ? t('approvalInvalid', { reason: approvalProblem }) : t('decisionApprove')}</div>
              <div className="row">
                <Button size="sm" kind="primary" onClick={() => go('review')}>
                  {t('openReview')} →
                </Button>
              </div>
            </div>
          )}
        </Step>

        <Step n={4} ok={planOk} title={t('uploadStepPlan')}>
          <div className="dim small">{t('dryRunHint')}</div>
          <div className="row wrap">
            <span className="dim small">{t('planSections')}:</span>
            <Check checked={flags.creatives} onChange={(v) => setFlags({ ...flags, creatives: v })}>
              {t('creatives')}
            </Check>
            <Check checked={flags.cpp} onChange={(v) => setFlags({ ...flags, cpp: v })} disabled={!o.files.cpp}>
              {t('cppPages')}
            </Check>
            <Check checked={flags.events} onChange={(v) => setFlags({ ...flags, events: v })}>
              {t('events')}
            </Check>
            <Check checked={flags.experiment} onChange={(v) => setFlags({ ...flags, experiment: v })} disabled={!o.files.experiments}>
              {t('experiment')}
            </Check>
            <Check checked={flags.skipScreenshots} onChange={(v) => setFlags({ ...flags, skipScreenshots: v })}>
              {t('skipScreenshots')}
            </Check>
          </div>
          <div className="row">
            <Button kind="primary" disabled={busy} title={cli('vitrin upload --dry-run')} onClick={() => run('upload', { dryRun: true, ...flagArgs })}>
              {t('dryRun')}
            </Button>
          </div>
          {planJob && planJob.status !== 'running' && (
            <div>
              <div className="row" style={{ marginBottom: 6 }}>
                <Pill tone={planJob.status === 'ok' ? 'ok' : planJob.status === 'needs-input' ? 'warn' : 'err'}>
                  {t('lastPlan')} · {fmtDate(planJob.endedAt)}
                </Pill>
                {planJob.message && <span className="small">{planJob.message}</span>}
              </div>
              <pre className="plan">{planText || planJob.details?.join('\n') || '—'}</pre>
            </div>
          )}
        </Step>

        <Step n={5} ok={Boolean(uploaded && uploaded.overallHash === o.approval?.overallHash)} title={t('uploadStepUpload')}>
          <div className="row">
            <Button kind="danger" disabled={!canUpload} title={cli('vitrin upload --yes')} onClick={() => setConfirm(true)}>
              {t('uploadNow')}
            </Button>
          </div>
          {waiting.length > 0 && <div className="text-err small">{t('uploadWaitsFor', { steps: waiting.join(', ') })}</div>}
        </Step>
      </div>

      <h3 style={{ margin: '22px 0 10px' }}>{t('afterUpload')}</h3>
      <div className="grid two">
        <Card title={t('readBack')}>
          {uploaded ? (
            <dl className="kv">
              <dt>{t('uploaded')}</dt>
              <dd>{fmtDate(uploaded.uploadedAt)}</dd>
              <dt>{t('readBack')}</dt>
              <dd>{uploaded.readBack === 'ok' ? <Pill tone="ok">{t('readBackOk')}</Pill> : <Pill tone="err">{uploaded.differences.length} {t('differences')}</Pill>}</dd>
              {uploaded.differences.map((d, i) => (
                <dd key={i} style={{ gridColumn: '1 / -1' }} className="small">
                  {d}
                </dd>
              ))}
            </dl>
          ) : (
            <span className="dim small">{t('notUploaded')}</span>
          )}
        </Card>
        <Card title={t('finalize')}>
          <div className="stack">
            <p className="dim small">{t('finalizeIntro')}</p>
            {o.approval?.finalized ? (
              <Pill tone="ok">
                {o.approval.finalized.mode} · {fmtDate(o.approval.finalized.at)}
              </Pill>
            ) : (
              <>
                <div className="stack tight">
                  <Radio name="research" checked={deleteResearch === true} onChange={() => setDeleteResearch(true)}>
                    {t('deleteResearch')}
                  </Radio>
                  <Radio name="research" checked={deleteResearch === false} onChange={() => setDeleteResearch(false)}>
                    {t('keepResearch')}
                  </Radio>
                </div>
                <div className="row">
                  <Button disabled={busy || !uploaded || deleteResearch === undefined} title={cli('vitrin finalize')} onClick={() => run('finalize', { checked: true, deleteResearch })}>
                    {t('finalize')}
                  </Button>
                </div>
                {!uploaded && <div className="dim small">{t('finalizeAfterUpload')}</div>}
              </>
            )}
          </div>
        </Card>
        <Card title={t('submit')}>
          <div className="stack">
            <p className="dim small">{t('submitHint')}</p>
            <div className="row">
              <input className="input mono" placeholder={o.app?.bundleId ?? t('bundleId')} value={bundle} onChange={(e) => setBundle(e.target.value)} />
              <Button kind="danger" disabled={busy || !bundle || bundle !== o.app?.bundleId} title={cli('vitrin submit')} onClick={() => run('submit', { confirm: bundle })}>
                {t('submit')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
      {confirm && (
        <Modal title={t('uploadNow')} onClose={() => setConfirm(false)}>
          <div className="stack">
            <p>{t('confirmUpload')}</p>
            <b>{appName}</b>
            <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
            <div className="row">
              <Button
                kind="danger"
                disabled={typed.trim() !== appName.trim()}
                onClick={() => {
                  setConfirm(false);
                  setTyped('');
                  void run('upload', { yes: true, ...flagArgs });
                }}
              >
                {t('uploadNow')}
              </Button>
              <Button onClick={() => setConfirm(false)}>{t('cancel')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** One step of the checklist: its number turns into ✓ once it is done. */
function Step({ n, ok, title, actions, children }: { n: number; ok: boolean; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={`check-step ${ok ? 'ok' : ''}`}>
      <div className="num">{ok ? '✓' : n}</div>
      <div className="stack">
        <div className="row">
          <b className="grow">{title}</b>
          {actions}
        </div>
        {children}
      </div>
    </section>
  );
}
