import { useEffect, useState } from 'react';
import type { JobSummary } from '../api';
import { t } from '../i18n';
import { useBusy, useStudio } from '../store';
import { Button, Card, Check, Field, Pill, Select } from '../ui';

/** Platforms, content, formats, languages, the uploader and how screens are made — `vitrin select` from a form. */
export function Setup() {
  const { state, run } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const p = o.platforms;
  const cfg = o.config!;

  const [platforms, setPlatforms] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [locales, setLocales] = useState<string[]>([]);
  const [newLocale, setNewLocale] = useState('');
  const [language, setLanguage] = useState<string>('');
  const [uploader, setUploader] = useState<string>('');
  const [capture, setCapture] = useState<string>('');
  const [doctor, setDoctor] = useState<JobSummary | undefined>();

  useEffect(() => {
    setPlatforms(p ? p.platforms.filter((x) => x.selected).map((x) => x.platform) : []);
    setAssets(p ? p.assets.filter((x) => x.selected).map((x) => x.asset) : []);
    setTargets(p ? p.formats.filter((x) => x.selected).map((x) => x.target) : []);
    setLocales(cfg.locales);
    setLanguage(cfg.language ?? 'en');
    setUploader(cfg.uploader ?? '');
    setCapture(cfg.capture);
  }, [o]);

  useEffect(() => {
    if (state.job?.command === 'doctor') setDoctor(state.job);
  }, [state.job]);
  // The finished doctor job arrives through the job event; the overview refresh does not carry it, so watch jobs.
  useEffect(() => {
    if (!state.job && doctor?.status === 'running') void import('../api').then(({ api }) => api.job(doctor.id).then((j) => setDoctor(j)));
  }, [state.job, doctor]);

  const save = () => {
    const args: Record<string, unknown> = {};
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (p && !same(platforms, p.platforms.filter((x) => x.selected).map((x) => x.platform))) args.platforms = platforms;
    if (p && !same(assets, p.assets.filter((x) => x.selected).map((x) => x.asset))) args.assets = assets;
    if (p && !same(targets, p.formats.filter((x) => x.selected).map((x) => x.target))) args.targets = targets;
    if (!same(locales, cfg.locales)) args.locales = locales;
    if (language !== (cfg.language ?? 'en')) args.language = language === 'en' ? 'default' : language;
    if (uploader && uploader !== (cfg.uploader ?? '')) args.uploader = uploader;
    if (capture !== cfg.capture) args.capture = capture;
    if (Object.keys(args).length) void run('select', args);
  };

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const byPlatform = new Map<string, NonNullable<typeof p>['formats']>();
  for (const f of p?.formats ?? []) byPlatform.set(f.platform, [...(byPlatform.get(f.platform) ?? []), f]);

  return (
    <div className="page">
      <header>
        <h2>{t('setup')}</h2>
        <p>{t('setupIntro')}</p>
      </header>
      <div className="grid two">
        <div className="stack">
          {!p && <Card>{t('stageAnalyze')}: run <code>vitrin analyze</code> first to see the detected platforms.</Card>}
          {p && (
            <>
              <Card title={t('platforms')}>
                <div className="row wrap">
                  {p.platforms.map((x) => (
                    <Check key={x.platform} checked={platforms.includes(x.platform)} onChange={(on) => toggle(platforms, setPlatforms, x.platform, on)}>
                      {x.label} {x.detected && <Pill tone="ok">{t('detected')}</Pill>}
                    </Check>
                  ))}
                </div>
              </Card>
              <Card title={t('content')}>
                <div className="row wrap">
                  {p.assets.map((x) => (
                    <Check key={x.asset} checked={assets.includes(x.asset)} onChange={(on) => toggle(assets, setAssets, x.asset, on)}>
                      {x.label}
                    </Check>
                  ))}
                </div>
              </Card>
              <Card title={t('formats')}>
                <div className="stack">
                  {[...byPlatform.entries()].map(([platform, formats]) => (
                    <div key={platform}>
                      <div className="dim small" style={{ marginBottom: 6 }}>
                        {platform}
                      </div>
                      <div className="row wrap">
                        {formats.map((f) => (
                          <Check key={f.target} checked={targets.includes(f.target)} onChange={(on) => toggle(targets, setTargets, f.target, on)}>
                            {f.label} <span className="dim mono">{f.size}</span> {f.required && <Pill tone="info">{t('required')}</Pill>}
                          </Check>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
          <Card title={t('storeLocales')}>
            <div className="row wrap">
              {[...new Set([...locales, ...(p?.locales.map((l) => l.locale) ?? [])])].map((l) => (
                <Check key={l} checked={locales.includes(l)} onChange={(on) => toggle(locales, setLocales, l, on)}>
                  {l} {p?.locales.find((x) => x.locale === l)?.detected && <Pill tone="ok">{t('detected')}</Pill>}
                </Check>
              ))}
              <input
                className="input"
                style={{ width: 120 }}
                placeholder="de-DE"
                value={newLocale}
                onChange={(e) => setNewLocale(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newLocale.trim()) {
                    toggle(locales, setLocales, newLocale.trim(), true);
                    setNewLocale('');
                  }
                }}
              />
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title={t('language')}>
            <Select value={language} onChange={setLanguage} options={[{ value: 'en', label: 'English' }, { value: 'tr', label: 'Türkçe' }, ...(language && !['en', 'tr'].includes(language) ? [{ value: language, label: language }] : [])]} />
          </Card>
          <Card title={t('uploader')}>
            <div className="stack">
              <Check checked={uploader === 'asc'} onChange={() => setUploader('asc')}>
                asc CLI {o.tools.asc ? <Pill tone="ok">{t('installed')} {o.tools.asc}</Pill> : <Pill tone="warn">{t('missing')} · brew install asc</Pill>}
              </Check>
              <Check checked={uploader === 'deliver'} onChange={() => setUploader('deliver')}>
                fastlane deliver {o.tools.fastlane ? <Pill tone="ok">{t('installed')} {o.tools.fastlane}</Pill> : <Pill tone="warn">{t('missing')}</Pill>}
              </Check>
            </div>
          </Card>
          <Card title={t('captureMode')}>
            <div className="stack">
              <Check checked={capture === 'html'} onChange={() => setCapture('html')}>
                {t('captureHtml')}
              </Check>
              <Check checked={capture === 'launch-args'} onChange={() => setCapture('launch-args')}>
                {t('captureLaunch')}
              </Check>
              <Check checked={capture === 'manual'} onChange={() => setCapture('manual')}>
                {t('captureManual')}
              </Check>
            </div>
          </Card>
          <Button kind="primary" disabled={busy} onClick={save}>
            {t('applySelection')}
          </Button>
          <Card title={t('tools')}>
            <dl className="kv">
              {(['claude', 'ffmpeg', 'asc', 'fastlane', 'ruby', 'bundler', 'brew'] as const).map((k) => (
                <Fragment2 key={k} name={k} value={o.tools[k] ?? null} />
              ))}
            </dl>
          </Card>
          <Card
            title={t('keys')}
            actions={
              <div className="row">
                <Button size="sm" disabled={busy} onClick={() => run('doctor', { tools: true })}>
                  {t('doctorTools')}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => run('doctor', {})}>
                  {t('doctor')}
                </Button>
              </div>
            }
          >
            {o.missingKeys.length === 0 ? (
              <Pill tone="ok">{t('keysOk')}</Pill>
            ) : (
              <div className="stack">
                <div>
                  {t('keysMissing')}{' '}
                  {o.missingKeys.map((k) => (
                    <code key={k} style={{ marginRight: 6 }}>
                      {k}
                    </code>
                  ))}
                </div>
                <div className="dim small">{t('keysHint')}</div>
              </div>
            )}
            {doctor?.result ? <DoctorChecks result={doctor.result as { checks: Array<{ id: string; title: string; status: string; detail?: string; fix?: string }> }} /> : null}
          </Card>
          <Card title={t('seeds')}>
            <div className="dim small" style={{ marginBottom: 6 }}>
              {t('seedsHint')}
            </div>
            {Array.isArray(cfg.seeds) ? (
              <div>{cfg.seeds.join(', ') || '—'}</div>
            ) : (
              <dl className="kv">
                {Object.entries(cfg.seeds).map(([l, s]) => (
                  <Fragment2 key={l} name={l} value={s.join(', ')} plain />
                ))}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fragment2({ name, value, plain }: { name: string; value: string | null; plain?: boolean }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{plain ? value : value ? <Pill tone="ok">{value.length > 40 ? t('installed') : value}</Pill> : <Pill tone="warn">{t('missing')}</Pill>}</dd>
    </>
  );
}

export function DoctorChecks({ result }: { result: { checks: Array<{ id: string; title: string; status: string; detail?: string; fix?: string }> } }) {
  const icon: Record<string, string> = { ok: '✓', warn: '⚠', fail: '✗', skip: '–' };
  const color: Record<string, string> = { ok: 'var(--ok)', warn: 'var(--warn)', fail: 'var(--err)', skip: 'var(--text-3)' };
  return (
    <div className="checks" style={{ marginTop: 10 }}>
      {result.checks.map((c) => (
        <div key={c.id} className="c">
          <span style={{ color: color[c.status] }}>{icon[c.status] ?? '·'}</span>
          <div>
            <div>{c.title}</div>
            {c.detail && <div className="d">{c.detail}</div>}
            {c.fix && (
              <div className="d">
                {t('fix')}: {c.fix}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export { Field };
