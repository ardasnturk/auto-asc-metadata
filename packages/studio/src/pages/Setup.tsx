import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { JobSummary, Overview } from '../api';
import { t, type UiKey } from '../i18n';
import { BlockerItem, CopyCode } from '../status';
import { useBusy, useStudio } from '../store';
import { Button, Card, Check, Field, Pill, Radio, Select } from '../ui';

/**
 * What this run produces and how it reaches the store, in the order the run needs it: languages, platforms and formats,
 * content, how screens are made, the uploader, the tools and the keys. Edits collect in a draft; a bar at the bottom
 * saves them with `vitrin select` (or discards them) and appears only when something changed.
 */

const PLATFORM_LABEL: Record<string, UiKey> = { ios: 'platformIos', macos: 'platformMacos', watchos: 'platformWatchos', tvos: 'platformTvos', visionos: 'platformVisionos', android: 'platformAndroid' };
const ASSET_LABEL: Record<string, UiKey> = { metadata: 'assetMetadata', screenshots: 'assetScreenshots', previews: 'assetPreviews', creatives: 'assetCreatives', events: 'assetEvents' };
const KIND_LABEL: Record<string, UiKey> = { screenshot: 'kindScreenshot', preview: 'kindPreview', creative: 'kindCreative', event: 'kindEvent' };
const CAPTURE: Array<{ mode: string; label: UiKey; hint: UiKey }> = [
  { mode: 'html', label: 'captureHtml', hint: 'captureHtmlHint' },
  { mode: 'launch-args', label: 'captureLaunch', hint: 'captureLaunchHint' },
  { mode: 'manual', label: 'captureManual', hint: 'captureManualHint' },
];
/** Example lines for .env: names only, never values. */
const ENV_LINE: Record<string, string> = { ASC_KEY_PATH: 'ASC_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8', GOOGLE_PLAY_JSON_KEY_PATH: 'GOOGLE_PLAY_JSON_KEY_PATH=./secrets/google-play.json' };

interface Draft {
  platforms: string[];
  assets: string[];
  targets: string[];
  locales: string[];
  primaryLocale: string;
  language: string;
  uploader: string;
  capture: string;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** "de-DE" → "German (Germany)" in the Studio's language; the tag itself when Intl does not know it. */
function localeName(tag: string, language: string): string {
  try {
    return new Intl.DisplayNames([language], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function Setup() {
  const { state, run } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const p = o.platforms;
  const cfg = o.config!;

  const saved = useMemo<Draft>(
    () => ({
      platforms: p ? p.platforms.filter((x) => x.selected).map((x) => x.platform) : [],
      assets: p ? p.assets.filter((x) => x.selected).map((x) => x.asset) : [],
      targets: p ? p.formats.filter((x) => x.selected).map((x) => x.target) : [],
      locales: cfg.locales,
      primaryLocale: cfg.primaryLocale,
      language: cfg.language ?? 'en',
      uploader: cfg.uploader ?? '',
      capture: cfg.capture,
    }),
    [p, cfg],
  );
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<Draft>(saved);
  // Only a change of the saved config resets the draft: an overview refresh (Claude or a stage wrote a file) keeps edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(saved), [savedKey]);

  const [doctor, setDoctor] = useState<JobSummary | undefined>();
  useEffect(() => {
    if (state.job?.command === 'doctor') setDoctor(state.job);
  }, [state.job]);
  // The finished doctor job arrives through the job event; the overview refresh does not carry it, so watch jobs.
  useEffect(() => {
    if (!state.job && doctor?.status === 'running') void import('../api').then(({ api }) => api.job(doctor.id).then((j) => setDoctor(j)));
  }, [state.job, doctor]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const toggle = (key: 'platforms' | 'assets' | 'targets' | 'locales', id: string, on: boolean) => setDraft((d) => ({ ...d, [key]: on ? [...new Set([...d[key], id])] : d[key].filter((x) => x !== id) }));

  const args: Record<string, unknown> = {};
  if (p && !same(draft.platforms, saved.platforms)) args.platforms = draft.platforms;
  if (p && !same(draft.assets, saved.assets)) args.assets = draft.assets;
  if (p && !same(draft.targets, saved.targets)) args.targets = draft.targets;
  if (!same(draft.locales, saved.locales)) args.locales = draft.locales;
  if (draft.primaryLocale !== saved.primaryLocale) args.primaryLocale = draft.primaryLocale;
  if (draft.language !== saved.language) args.language = draft.language === 'en' ? 'default' : draft.language;
  if (draft.uploader && draft.uploader !== saved.uploader) args.uploader = draft.uploader;
  if (draft.capture !== saved.capture) args.capture = draft.capture;
  const changes = Object.keys(args).length;

  const localeBlockers = o.blockers.filter((b) => b.code === 'stray-locales' || b.code === 'primary-locale');
  const allLocales = [...new Set([...draft.locales, ...(p?.locales.map((l) => l.locale) ?? []), ...o.listing])];
  const byPlatform = new Map<string, NonNullable<typeof p>['formats']>();
  for (const f of p?.formats ?? []) byPlatform.set(f.platform, [...(byPlatform.get(f.platform) ?? []), f]);
  const lang = cfg.language ?? 'en';

  return (
    <div className="page setup">
      <header>
        <h2>{t('setup')}</h2>
        <p>{t('setupIntro')}</p>
      </header>
      <div className="stack">
        <Section n={1} title={t('sectionLanguages')}>
          {localeBlockers.map((b) => (
            <BlockerItem key={b.code} blocker={b} primary />
          ))}
          <Field label={t('storeLocales')} hint={t('storeLocalesHint')}>
            <div className="row wrap">
              {allLocales.map((l) => (
                <Check key={l} checked={draft.locales.includes(l)} onChange={(on) => toggle('locales', l, on)}>
                  <span title={l}>{localeName(l, lang)}</span> <span className="dim mono small">{l}</span>
                  {o.listing.includes(l) && <Pill tone="ok">{t('hasText')}</Pill>}
                </Check>
              ))}
              <NewLocale onAdd={(l) => toggle('locales', l, true)} />
            </div>
          </Field>
          <div className="grid two">
            <Field label={t('primaryLocaleLabel')} hint={t('primaryLocaleHint')}>
              <Select
                value={draft.primaryLocale}
                onChange={(v) => set('primaryLocale', v)}
                options={[...draft.locales, ...(draft.locales.includes(draft.primaryLocale) ? [] : [draft.primaryLocale])].map((l) => ({ value: l, label: `${localeName(l, lang)} (${l})${draft.locales.includes(l) ? '' : ` · ${t('notSelected')}`}` }))}
              />
            </Field>
            <Field label={t('uiLanguageLabel')}>
              <Select value={draft.language} onChange={(v) => set('language', v)} options={[{ value: 'en', label: 'English' }, { value: 'tr', label: 'Türkçe' }, ...(!['en', 'tr'].includes(draft.language) ? [{ value: draft.language, label: draft.language }] : [])]} />
            </Field>
          </div>
        </Section>

        <Section n={2} title={t('sectionPlatforms')}>
          {!p ? (
            <div className="dim">{t('needsAnalyze')}</div>
          ) : (
            <>
              <div className="row wrap">
                {p.platforms.map((x) => (
                  <Check key={x.platform} checked={draft.platforms.includes(x.platform)} onChange={(on) => toggle('platforms', x.platform, on)}>
                    {PLATFORM_LABEL[x.platform] ? t(PLATFORM_LABEL[x.platform]!) : x.label} {x.detected && <Pill tone="ok">{t('detected')}</Pill>}
                  </Check>
                ))}
              </div>
              {[...byPlatform.entries()].map(([platform, formats]) => (
                <Field key={platform} label={`${t('formats')} · ${PLATFORM_LABEL[platform] ? t(PLATFORM_LABEL[platform]!) : platform}`}>
                  <div className="stack tight">
                    {[...new Set(formats.map((f) => f.kind))].map((kind) => (
                      <div key={kind} className="row wrap">
                        <span className="dim small format-kind">{KIND_LABEL[kind] ? t(KIND_LABEL[kind]!) : kind}</span>
                        {formats
                          .filter((f) => f.kind === kind)
                          .map((f) => (
                            <Check key={f.target} checked={draft.targets.includes(f.target)} onChange={(on) => toggle('targets', f.target, on)}>
                              {f.label} <span className="dim mono small">{f.size}</span> {f.required && <Pill tone="info">{t('required')}</Pill>}
                            </Check>
                          ))}
                      </div>
                    ))}
                  </div>
                </Field>
              ))}
            </>
          )}
        </Section>

        <Section n={3} title={t('content')}>
          {!p ? (
            <div className="dim">{t('needsAnalyze')}</div>
          ) : (
            <div className="row wrap">
              {p.assets.map((x) => (
                <Check key={x.asset} checked={draft.assets.includes(x.asset)} onChange={(on) => toggle('assets', x.asset, on)}>
                  {ASSET_LABEL[x.asset] ? t(ASSET_LABEL[x.asset]!) : x.label}
                </Check>
              ))}
            </div>
          )}
        </Section>

        <Section n={4} title={t('captureMode')}>
          <div className="stack tight">
            {[...CAPTURE, ...(CAPTURE.some((c) => c.mode === draft.capture) ? [] : [{ mode: draft.capture, label: 'captureMode' as UiKey, hint: undefined }])].map((c) => (
              <Radio key={c.mode} name="capture" checked={draft.capture === c.mode} onChange={() => set('capture', c.mode)} hint={c.hint ? t(c.hint) : undefined}>
                {c.label === 'captureMode' ? c.mode : t(c.label)}
              </Radio>
            ))}
          </div>
        </Section>

        <Section n={5} title={t('uploader')}>
          {!draft.uploader && <div className="text-err small">{t('blockerUploaderUnset')}</div>}
          <div className="stack tight">
            <Radio name="uploader" checked={draft.uploader === 'asc'} onChange={() => set('uploader', 'asc')} hint={t('uploaderAscHint')}>
              asc CLI {o.tools.asc ? <Pill tone="ok">{`${t('installed')} ${o.tools.asc}`}</Pill> : <Pill tone="warn">{t('missing')}</Pill>}
            </Radio>
            {draft.uploader === 'asc' && !o.tools.asc && <CopyCode text="brew install asc" />}
            <Radio name="uploader" checked={draft.uploader === 'deliver'} onChange={() => set('uploader', 'deliver')} hint={t('uploaderDeliverHint')}>
              fastlane deliver {o.tools.fastlane ? <Pill tone="ok">{`${t('installed')} ${o.tools.fastlane}`}</Pill> : <Pill tone="warn">{t('missing')}</Pill>}
            </Radio>
            {draft.uploader === 'deliver' && !o.tools.fastlane && <CopyCode text="bundle install" />}
          </div>
        </Section>

        <Section n={6} title={t('tools')}>
          <div className="dim small">{t('toolsHint')}</div>
          <Tools o={o} draft={draft} />
        </Section>

        <Section
          n={7}
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
          <Keys o={o} />
          {doctor?.result ? <DoctorChecks result={doctor.result as { checks: Array<{ id: string; title: string; status: string; detail?: string; fix?: string }> }} /> : null}
        </Section>

        <Section n={8} title={t('seeds')}>
          <div className="dim small">{t('seedsHint')}</div>
          {Array.isArray(cfg.seeds) ? (
            <div>{cfg.seeds.join(', ') || '—'}</div>
          ) : (
            <dl className="kv">
              {Object.entries(cfg.seeds).map(([l, s]) => (
                <Fragment key={l}>
                  <dt>{l}</dt>
                  <dd>{s.join(', ')}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </Section>
      </div>
      {changes > 0 && (
        <div className="savebar">
          <span>{t('unsavedChanges', { n: changes })}</span>
          <span className="grow" />
          <Button onClick={() => setDraft(saved)}>{t('discard')}</Button>
          <Button kind="primary" disabled={busy} title="vitrin select" onClick={() => run('select', args)}>
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({ n, title, actions, children }: { n: number; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card
      className="setup-section"
      title={
        <>
          <span className="section-num">{n}</span> {title}
        </>
      }
      actions={actions}
    >
      <div className="stack">{children}</div>
    </Card>
  );
}

function NewLocale({ onAdd }: { onAdd: (locale: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <input
      className="input"
      style={{ width: 240 }}
      placeholder={t('addLocale')}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          onAdd(value.trim());
          setValue('');
        }
      }}
    />
  );
}

/** Each tool, why this run needs it (or not, for this selection) and how to install it. */
function Tools({ o, draft }: { o: Overview; draft: Draft }) {
  const video = o.flow.find((s) => s.id === 'video')?.status !== 'skipped';
  const fastlane = draft.uploader === 'deliver' || draft.uploader === 'asset-library' || draft.platforms.includes('android');
  const rows: Array<{ id: keyof Overview['tools']; why: UiKey; needed: boolean; install: string }> = [
    { id: 'claude', why: 'toolWhyClaude', needed: true, install: 'npm install -g @anthropic-ai/claude-code' },
    { id: 'ffmpeg', why: 'toolWhyFfmpeg', needed: video, install: 'brew install ffmpeg' },
    { id: 'asc', why: 'toolWhyAsc', needed: draft.uploader === 'asc', install: 'brew install asc' },
    { id: 'fastlane', why: 'toolWhyFastlane', needed: fastlane, install: 'bundle install' },
    { id: 'ruby', why: 'toolWhyRuby', needed: fastlane, install: 'brew install ruby' },
    { id: 'bundler', why: 'toolWhyBundler', needed: fastlane, install: 'gem install bundler' },
    { id: 'brew', why: 'toolWhyBrew', needed: (video && !o.tools.ffmpeg) || (draft.uploader === 'asc' && !o.tools.asc), install: 'https://brew.sh' },
  ];
  return (
    <div className="tools">
      {rows.map((r) => {
        const value = o.tools[r.id] ?? null;
        return (
          <div key={r.id} className={`tool ${!value && r.needed ? 'missing' : ''}`}>
            <span className="mono">{r.id}</span>
            <span className="dim small">
              {t(r.why)}
              {r.needed ? '' : ` · ${t('notNeeded')}`}
            </span>
            <span>{value ? <Pill tone="ok">{value.includes('/') || value.length > 24 ? t('installed') : value}</Pill> : <Pill tone={r.needed ? 'err' : undefined}>{t('missing')}</Pill>}</span>
            <span>{!value && r.needed && <CopyCode text={r.install} />}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The upload keys: which are missing, how to get them and the .env lines to paste (names only). */
function Keys({ o }: { o: Overview }) {
  if (o.missingKeys.length === 0) return <Pill tone="ok">{t('keysOk')}</Pill>;
  const apple = o.missingKeys.some((k) => k.startsWith('ASC_'));
  const play = o.missingKeys.some((k) => k.startsWith('GOOGLE_PLAY_'));
  return (
    <>
      <div>
        {t('keysMissing')}{' '}
        {o.missingKeys.map((k) => (
          <code key={k} style={{ marginRight: 6 }}>
            {k}
          </code>
        ))}
      </div>
      {apple && (
        <div>
          <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
            {t('keysStepsTitle')}
          </div>
          <ol className="steps">
            <li>{t('keysStep1')}</li>
            <li>{t('keysStep2')}</li>
            <li>{t('keysStep3')}</li>
          </ol>
        </div>
      )}
      {play && <div className="small">{t('keysPlayStep')}</div>}
      <div className="dim small">{t('keysEnvSnippet')}</div>
      <CopyCode block text={o.missingKeys.map((k) => ENV_LINE[k] ?? `${k}=`).join('\n')} />
      <div className="dim small">{t('keysHint')}</div>
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
