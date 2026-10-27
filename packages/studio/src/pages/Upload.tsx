import { useEffect, useState } from 'react';
import { api, type JobSummary } from '../api';
import { t } from '../i18n';
import { useBusy, useStudio } from '../store';
import { Button, Card, Check, fmtDate, Modal, Pill } from '../ui';
import { DoctorChecks } from './Setup';

/** Keys (names only) → doctor → dry-run plan → the upload after the user's explicit confirmation → read-back → finalize. */
export function Upload() {
  const { state, run } = useStudio();
  const busy = useBusy();
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

  const approved = o.approval?.status === 'approved';
  const uploaded = o.approval?.upload;
  const appName = o.app?.name ?? '';
  const canUpload = approved && o.missingKeys.length === 0 && !busy;
  const flagArgs = { creatives: flags.creatives, cpp: flags.cpp, events: flags.events, experiment: flags.experiment || undefined, skipScreenshots: flags.skipScreenshots };

  return (
    <div className="page">
      <header>
        <h2>{t('upload')}</h2>
        <p>{t('uploadIntro')}</p>
      </header>
      <div className="grid two">
        <div className="stack">
          <Card
            title={t('keys')}
            actions={
              <Button size="sm" disabled={busy} onClick={() => run('doctor', {})}>
                {t('doctor')}
              </Button>
            }
          >
            <div className="stack">
              <div className="row wrap">
                {o.missingKeys.length === 0 ? (
                  <Pill tone="ok">{t('keysOk')}</Pill>
                ) : (
                  o.missingKeys.map((k) => (
                    <Pill key={k} tone="warn">
                      {k}
                    </Pill>
                  ))
                )}
                <Pill tone={o.config?.uploader ? 'ok' : 'warn'}>
                  {t('uploader')}: {o.config?.uploader ?? '—'}
                </Pill>
                <Pill tone={approved ? 'ok' : 'warn'}>{approved ? `${t('approved')} ${fmtDate(o.approval?.approvedAt)}` : t('notApproved')}</Pill>
              </div>
              {o.missingKeys.length > 0 && <div className="dim small">{t('keysHint')}</div>}
              {doctor?.result ? <DoctorChecks result={doctor.result as { checks: Array<{ id: string; title: string; status: string; detail?: string; fix?: string }> }} /> : null}
            </div>
          </Card>
          <Card title={t('plan')}>
            <div className="stack">
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
                <Button kind="primary" disabled={busy} onClick={() => run('upload', { dryRun: true, ...flagArgs })}>
                  {t('dryRun')}
                </Button>
                <Button kind="danger" disabled={!canUpload} title={canUpload ? '' : t('uploadBlocked')} onClick={() => setConfirm(true)}>
                  {t('uploadNow')}
                </Button>
              </div>
              {planJob && planJob.status !== 'running' && (
                <div>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <Pill tone={planJob.status === 'ok' ? 'ok' : planJob.status === 'needs-input' ? 'warn' : 'err'}>
                      {t('lastPlan')}: {planJob.status} · {fmtDate(planJob.endedAt)}
                    </Pill>
                    {planJob.message && <span className="small">{planJob.message}</span>}
                  </div>
                  <pre className="plan">{planText || planJob.details?.join('\n') || '—'}</pre>
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title={t('readBack')}>
            {uploaded ? (
              <dl className="kv">
                <dt>{t('uploaded')}</dt>
                <dd>{fmtDate(uploaded.uploadedAt)}</dd>
                <dt>{t('readBack')}</dt>
                <dd>{uploaded.readBack === 'ok' ? <Pill tone="ok">ok</Pill> : <Pill tone="err">{uploaded.differences.length} {t('differences')}</Pill>}</dd>
                {uploaded.differences.map((d, i) => (
                  <dd key={i} style={{ gridColumn: '1 / -1' }} className="small">
                    {d}
                  </dd>
                ))}
              </dl>
            ) : (
              <span className="dim small">{t('nothingYet')}</span>
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
                  <div className="row wrap">
                    <Check checked={deleteResearch === true} onChange={() => setDeleteResearch(true)}>
                      {t('deleteResearch')}
                    </Check>
                    <Check checked={deleteResearch === false} onChange={() => setDeleteResearch(false)}>
                      {t('keepResearch')}
                    </Check>
                  </div>
                  <Button disabled={busy || !uploaded || deleteResearch === undefined} onClick={() => run('finalize', { checked: true, deleteResearch })}>
                    {t('finalize')}
                  </Button>
                </>
              )}
            </div>
          </Card>
          <Card title={t('submit')}>
            <div className="stack">
              <p className="dim small">{t('submitHint')}</p>
              <div className="row">
                <input className="input mono" placeholder={o.app?.bundleId ?? t('bundleId')} value={bundle} onChange={(e) => setBundle(e.target.value)} />
                <Button kind="danger" disabled={busy || !bundle || bundle !== o.app?.bundleId} onClick={() => run('submit', { confirm: bundle })}>
                  {t('submit')}
                </Button>
              </div>
            </div>
          </Card>
        </div>
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
