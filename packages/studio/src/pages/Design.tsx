import { useEffect, useState } from 'react';
import { api, fileUrl, type RenderedFile } from '../api';
import { t } from '../i18n';
import { BlockerItem, DesignOptionButtons, go, IssueList, QuestionCard } from '../status';
import { useBusy, useFile, useStudio } from '../store';
import { Button, Card, Check, CodeEditor, Empty, Field, ListInput, Lightbox, SaveBar, Select, Tabs, TextField, Thumb, useMode } from '../ui';

/** The store screenshots in three steps: pick a style from the samples, write each screenshot's text, render and preview the set. */

interface Option {
  id: string;
  name: string;
  rationale: string;
  differentiation: string;
  preset?: string;
  brand?: { primary: string; secondary?: string; strength?: number };
  palette?: Record<string, unknown>;
  emphasis?: string;
  kicker?: 'plain' | 'tag';
  cycle?: string[];
  [k: string]: unknown;
}
interface ArtDirection {
  options: Option[];
  selected: string;
  selectionReason: string;
}
interface ShotCopy {
  kicker?: string;
  headline: string;
  subheadline?: string;
}
interface Shot {
  id: string;
  slug: string;
  archetype: string;
  screens?: string[];
  captionPosition?: 'top' | 'bottom';
  copy: Record<string, ShotCopy>;
  featureIds: string[];
  framing?: string;
  inverted?: boolean;
  bridge?: boolean;
  template?: string;
  bullets?: Array<Record<string, string>>;
  bulletStyle?: 'check' | 'chips';
  brandMark?: boolean;
  photo?: string;
  [k: string]: unknown;
}
interface ShotList {
  shots: Shot[];
  creatives?: unknown;
}

type Step = 'style' | 'copy' | 'render';

export function Design({ openClaude }: { openClaude: () => void }) {
  const { state, toast } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const cfg = o.config!;
  const waiting = o.blockers.some((b) => b.code === 'design-choice') || o.questions.some((q) => q.stage === 'design');
  // Open where the work is: the style while a choice is open or none was made, the texts otherwise.
  const [step, setStep] = useState<Step>(waiting || !o.files.artDirection ? 'style' : 'copy');
  const hasBrief = o.briefs.some((b) => b.name === 'design');
  const steps: Array<{ id: Step; label: string }> = [
    { id: 'style', label: t('stepStyle') },
    { id: 'copy', label: t('stepCopy') },
    { id: 'render', label: t('stepRender') },
  ];
  return (
    <div className="page">
      <header>
        <h2>{t('design')}</h2>
        <p>{t('designIntro')}</p>
      </header>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="stepper">
          {steps.map((x, i) => (
            <button key={x.id} type="button" className={x.id === step ? 'on' : ''} onClick={() => setStep(x.id)}>
              <span className="section-num">{i + 1}</span> {x.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        {hasBrief && (
          <Button kind="primary" disabled={busy || !o.claude.available} onClick={() => api.askClaude({ stage: 'design' }).then(openClaude).catch((err) => toast((err as Error).message, 'err'))}>
            ✳ {t('askClaude')}
          </Button>
        )}
      </div>
      {step === 'style' && <StyleStep openClaude={openClaude} />}
      {step === 'copy' && <Shots locales={cfg.locales} />}
      {step === 'render' && <RenderStep locales={cfg.locales} />}
    </div>
  );
}

/** Step 1: the samples side by side, the open choice (or the one in use) and, under Advanced, the art direction itself. */
function StyleStep({ openClaude }: { openClaude: () => void }) {
  const { state, run } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const ad = useFile<ArtDirection>('metadata/art-direction.json');
  const [styles, setStyles] = useState<string[]>([]);
  const [big, setBig] = useState(false);
  const s = o.samples;
  const question = o.questions.find((q) => q.stage === 'design');
  const decision = o.blockers.find((b) => b.code === 'design-choice');
  const chosen = ad.data?.options.find((x) => x.id === ad.data?.selected);
  return (
    <div className="stack">
      {question ? <QuestionCard question={question} openClaude={openClaude} /> : decision ? <BlockerItem blocker={decision} openClaude={openClaude} /> : null}
      {!question && !decision && chosen && (
        <Card>
          <div className="stack">
            <div>
              <b>{t('chosenDesign', { name: chosen.name })}</b> {ad.data?.selectionReason && <span className="dim">· {ad.data.selectionReason}</span>}
            </div>
            {s?.options.length ? <DesignOptionButtons openClaude={openClaude} label={t('chooseDesign')} /> : null}
          </div>
        </Card>
      )}
      {!s ? (
        <Empty>
          <p style={{ marginBottom: 10 }}>{t('noSamplesYet')}</p>
          <Button kind="primary" disabled={busy} title="vitrin design --samples" onClick={() => run('design', { samples: true })}>
            {t('renderSamples')}
          </Button>
        </Empty>
      ) : (
        <>
          {s.storePreview && (
            <Card title={t('storePreview')} actions={<Button size="sm" onClick={() => window.open(fileUrl(s.storePreview!), '_blank')}>{t('open')}</Button>}>
              <iframe className="gallery-frame" src={fileUrl(s.storePreview, state.changedTick)} title="store preview" />
            </Card>
          )}
          {s.contactSheet && (
            <Card title={t('contactSheet')}>
              <img src={fileUrl(s.contactSheet, state.changedTick)} alt="" style={{ width: '100%', borderRadius: 8, cursor: 'zoom-in' }} onClick={() => setBig(true)} />
              {big && <Lightbox src={fileUrl(s.contactSheet, state.changedTick)} onClose={() => setBig(false)} />}
            </Card>
          )}
        </>
      )}
      <details className="advanced">
        <summary>{t('tryOtherStyles')}</summary>
        <div className="stack">
          <div className="row wrap">
            {o.enums.presets.map((p) => (
              <Check key={p} checked={styles.includes(p)} onChange={(on) => setStyles(on ? [...styles, p] : styles.filter((x) => x !== p))}>
                {p}
              </Check>
            ))}
          </div>
          <div className="row">
            <Button kind="primary" disabled={busy} title="vitrin design --samples" onClick={() => run('design', { samples: true, styles: styles.length ? styles : undefined })}>
              {t('renderSamples')} {styles.length ? `(${styles.length})` : ''}
            </Button>
            <span className="dim small">{o.platforms?.samples ? `${o.platforms.samples.locale} · ${o.platforms.samples.target}` : ''}</span>
          </div>
        </div>
      </details>
      <details className="advanced">
        <summary>{t('artDirectionAdvanced')}</summary>
        <ArtDirectionEditor />
      </details>
    </div>
  );
}

/** Step 3: render the whole set, see it the way the store shows it, and the image issues the quality gate found. */
function RenderStep({ locales }: { locales: string[] }) {
  const { state, run } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const [locale, setLocale] = useState(locales[0] ?? 'en-US');
  const [big, setBig] = useState<string | undefined>();
  const rendered = o.screenshots[locale] ?? [];
  const target = pickTarget(rendered);
  const issues = (o.validation?.issues ?? []).filter((i) => /^(image|shot|badge)\./.test(i.code) && (!i.locale || i.locale === locale));
  return (
    <div className="stack">
      <div className="row wrap">
        <Button kind="primary" disabled={busy} title="vitrin design" onClick={() => run('design')}>
          {t('renderAll')}
        </Button>
        <Button disabled={busy} title="vitrin validate" onClick={() => run('validate')}>
          {t('stageValidate')}
        </Button>
        <span className="grow" />
        <Button kind="ghost" onClick={() => go('review')}>
          {t('openReview')} →
        </Button>
      </div>
      <Tabs tabs={locales.map((l) => ({ id: l, label: l }))} value={locale} onChange={setLocale} />
      {rendered.length === 0 ? (
        <Empty>{t('noRenderYet')}</Empty>
      ) : (
        <Card title={`${t('storeStrip')}${target ? ` · ${target}` : ''}`}>
          <div className="store-strip">
            {rendered
              .filter((f) => !target || f.name.includes(`_${target}.`))
              .map((f) => (
                <img key={f.path} src={fileUrl(f.path, state.changedTick)} alt={f.name} onClick={() => setBig(fileUrl(f.path, state.changedTick))} />
              ))}
          </div>
        </Card>
      )}
      {issues.length > 0 && (
        <Card title={`${t('imageIssues')} · ${issues.length}`}>
          <IssueList issues={issues} />
        </Card>
      )}
      {big && <Lightbox src={big} onClose={() => setBig(undefined)} />}
    </div>
  );
}

function ArtDirectionEditor() {
  const { state } = useStudio();
  const o = state.overview!;
  const file = useFile<ArtDirection>('metadata/art-direction.json');
  const [mode, toggle] = useMode();
  if (file.loading) return <span className="dim">{t('loading')}</span>;
  const d = file.data;
  if (!d || mode === 'json') {
    return (
      <Card title={t('artDirection')} actions={toggle}>
        {!file.exists && !file.dirty ? (
          <Empty>
            <Button onClick={() => file.setData({ options: [{ id: 'brand', name: 'Brand', rationale: '', differentiation: '', preset: o.enums.presets[0] }], selected: 'brand', selectionReason: '' })}>{t('startEmpty')}</Button>
          </Empty>
        ) : (
          <CodeEditor file={file} />
        )}
      </Card>
    );
  }
  const setOpt = (i: number, patch: Partial<Option>) => file.setData({ ...d, options: d.options.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  return (
    <div className="stack">
      <Card title={t('artDirection')} actions={toggle}>
        <div className="grid two">
          <Field label={t('selectedOption')}>
            <Select value={d.selected} onChange={(v) => file.setData({ ...d, selected: v })} options={d.options.map((x) => ({ value: x.id, label: `${x.name} (${x.id})` }))} />
          </Field>
          <TextField label={t('rationale')} value={d.selectionReason} onChange={(v) => file.setData({ ...d, selectionReason: v })} />
        </div>
      </Card>
      <div className="grid two">
        {d.options.map((opt, i) => (
          <div key={opt.id} className={`option-card stack ${opt.id === d.selected ? 'selected' : ''}`}>
            <div className="row">
              <b className="grow">{opt.name}</b>
              <code className="dim">{opt.id}</code>
              {d.options.length > 1 && (
                <Button size="sm" kind="ghost" onClick={() => file.setData({ ...d, options: d.options.filter((_, n) => n !== i), selected: d.selected === opt.id ? d.options.find((_, n) => n !== i)!.id : d.selected })}>
                  ✕
                </Button>
              )}
            </div>
            <div className="grid two">
              <TextField label={t('slug')} value={opt.id} mono onChange={(v) => setOpt(i, { id: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
              <TextField label={t('name')} value={opt.name} onChange={(v) => setOpt(i, { name: v })} />
            </div>
            <div className="grid two">
              <Field label={t('preset')}>
                <Select value={opt.preset} onChange={(v) => setOpt(i, { preset: v || undefined })} options={o.enums.presets} allowEmpty={opt.palette ? t('bespokePalette') : '—'} />
              </Field>
              <Field label={t('brandPrimary')}>
                <div className="row">
                  <input type="color" value={opt.brand?.primary ?? '#7b6cff'} onChange={(e) => setOpt(i, { brand: { ...(opt.brand ?? { primary: '#000000' }), primary: e.target.value.toUpperCase() } })} />
                  <input className="input mono" value={opt.brand?.primary ?? ''} placeholder="#RRGGBB" onChange={(e) => setOpt(i, { brand: e.target.value ? { ...(opt.brand ?? { primary: '#000000' }), primary: e.target.value } : undefined })} />
                </div>
              </Field>
            </div>
            <div className="grid two">
              <Field label={t('emphasis')}>
                <Select value={opt.emphasis} onChange={(v) => setOpt(i, { emphasis: v || undefined })} options={o.enums.emphasis} allowEmpty={t('fromPreset')} />
              </Field>
              <Field label={t('kicker')}>
                <Select value={opt.kicker} onChange={(v) => setOpt(i, { kicker: (v || undefined) as Option['kicker'] })} options={['plain', 'tag']} allowEmpty={t('fromPreset')} />
              </Field>
            </div>
            <Field label={t('cycle')} hint={t('cycleHint')}>
              <div className="row">
                <div className="grow">
                  <ListInput value={opt.cycle ?? []} placeholder="#3D5AFE, #FF6A3D, #0B7A5E" onChange={(v) => setOpt(i, { cycle: v.length ? v : undefined })} />
                </div>
                <div className="swatches">
                  {(opt.cycle ?? []).map((c, n) => (
                    <i key={n} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </Field>
            <TextField label={t('rationale')} value={opt.rationale} multiline rows={2} onChange={(v) => setOpt(i, { rationale: v })} />
            <TextField label={t('differentiation')} value={opt.differentiation} multiline rows={2} onChange={(v) => setOpt(i, { differentiation: v })} />
          </div>
        ))}
        {d.options.length < 6 && (
          <div className="option-card row" style={{ justifyContent: 'center', minHeight: 120 }}>
            <Button onClick={() => file.setData({ ...d, options: [...d.options, { id: `option-${d.options.length + 1}`, name: `Option ${d.options.length + 1}`, rationale: '', differentiation: '', preset: o.enums.presets[d.options.length % o.enums.presets.length] }] })}>+ {t('options')}</Button>
          </div>
        )}
      </div>
      <SaveBar file={file} />
    </div>
  );
}

function Shots({ locales }: { locales: string[] }) {
  const { state, run } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const file = useFile<ShotList>('metadata/shots.json');
  const [mode, toggle] = useMode();
  const [locale, setLocale] = useState(locales[0] ?? 'en-US');
  const [sel, setSel] = useState(0);
  const [big, setBig] = useState<string | undefined>();
  const d = file.data;
  const shots = d?.shots ?? [];
  useEffect(() => {
    if (sel >= shots.length) setSel(Math.max(0, shots.length - 1));
  }, [shots.length, sel]);

  const rendered = o.screenshots[locale] ?? [];
  const primaryTarget = pickTarget(rendered);
  const imageFor = (id: string): RenderedFile | undefined => rendered.find((f) => f.name.startsWith(`${id}_`) && (!primaryTarget || f.name.includes(`_${primaryTarget}.`))) ?? rendered.find((f) => f.name.startsWith(`${id}_`));

  if (file.loading) return <span className="dim">{t('loading')}</span>;
  if (!d || mode === 'json') {
    return (
      <Card title="shots.json" actions={toggle}>
        {!file.exists && !file.dirty ? (
          <Empty>
            <p style={{ marginBottom: 10 }}>{t('noShots')}</p>
            <Button onClick={() => file.setData({ shots: [newShot('01', locales)] })}>{t('startEmpty')}</Button>
          </Empty>
        ) : (
          <CodeEditor file={file} />
        )}
      </Card>
    );
  }
  const shot = shots[sel];
  const setShot = (patch: Partial<Shot>) => file.setData({ ...d, shots: shots.map((s, n) => (n === sel ? { ...s, ...patch } : s)) });
  const move = (dir: -1 | 1) => {
    const j = sel + dir;
    if (j < 0 || j >= shots.length) return;
    const next = [...shots];
    [next[sel], next[j]] = [next[j]!, next[sel]!];
    file.setData({ ...d, shots: next.map((s, n) => ({ ...s, id: String(n + 1).padStart(2, '0') })) });
    setSel(j);
  };

  return (
    <div className="stack">
      <div className="row">
        <Tabs tabs={locales.map((l) => ({ id: l, label: l }))} value={locale} onChange={setLocale} />
        <span className="grow" />
        {toggle}
      </div>
      <div className="design-wrap">
        <div className="design-grid">
          <div className="stack">
            <div className="shot-list">
              {shots.map((s, i) => {
                const img = imageFor(s.id);
                return (
                  <div key={s.id + i} className={`shot-row ${i === sel ? 'active' : ''}`} onClick={() => setSel(i)}>
                    {img ? <img src={fileUrl(img.path, state.changedTick)} alt="" /> : <div className="ph" />}
                    <div>
                      <div>
                        <b>{s.id}</b> <span className="dim">{s.slug}</span>
                      </div>
                      <div className="dim small">
                        {s.archetype} · {s.framing ?? 'auto'}
                      </div>
                      <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.copy[locale]?.headline ?? <span className="dim">—</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button disabled={shots.length >= 10} onClick={() => file.setData({ ...d, shots: [...shots, newShot(String(shots.length + 1).padStart(2, '0'), locales)] })}>
              + {t('addShot')}
            </Button>
          </div>
          {shot ? (
            <Card
              title={
                <span>
                  {shot.id} <span className="dim">{shot.slug}</span>
                </span>
              }
              actions={
                <div className="row">
                  <Button size="sm" kind="ghost" onClick={() => move(-1)} disabled={sel === 0}>
                    ↑
                  </Button>
                  <Button size="sm" kind="ghost" onClick={() => move(1)} disabled={sel === shots.length - 1}>
                    ↓
                  </Button>
                  <Button size="sm" kind="danger" disabled={shots.length <= 1} onClick={() => file.setData({ ...d, shots: shots.filter((_, n) => n !== sel).map((s, n) => ({ ...s, id: String(n + 1).padStart(2, '0') })) })}>
                    {t('removeShot')}
                  </Button>
                  <Button size="sm" kind="primary" disabled={busy || file.dirty} title={file.dirty ? t('save') : ''} onClick={() => run('design', { only: [shot.id] })}>
                    {t('renderShot')}
                  </Button>
                </div>
              }
            >
              <div className="stack">
                <Card className="tight" title={`${t('headline')} · ${locale}`}>
                  <div className="stack">
                    <TextField label={t('kicker')} value={shot.copy[locale]?.kicker ?? ''} onChange={(v) => setShot({ copy: { ...shot.copy, [locale]: { ...(shot.copy[locale] ?? { headline: '' }), kicker: v } } })} />
                    <TextField
                      label={t('headline')}
                      value={shot.copy[locale]?.headline ?? ''}
                      onChange={(v) => setShot({ copy: { ...shot.copy, [locale]: { ...(shot.copy[locale] ?? { headline: '' }), headline: v } } })}
                      hint={t('headlineHint', { n: (shot.copy[locale]?.headline ?? '').trim().split(/\s+/).filter(Boolean).length })}
                    />
                    <TextField label={t('subheadline')} value={shot.copy[locale]?.subheadline ?? ''} onChange={(v) => setShot({ copy: { ...shot.copy, [locale]: { ...(shot.copy[locale] ?? { headline: '' }), subheadline: v } } })} />
                    <TextField
                      label={t('bulletsLabel')}
                      value={(shot.bullets ?? []).map((b) => b[locale] ?? '').join('\n')}
                      multiline
                      rows={3}
                      onChange={(v) => {
                        const lines = v.split('\n');
                        const bullets = lines.map((line, n) => ({ ...(shot.bullets?.[n] ?? {}), [locale]: line }));
                        setShot({ bullets: bullets.filter((b) => Object.values(b).some(Boolean)).slice(0, 4) });
                      }}
                    />
                  </div>
                </Card>
                <ScreenPicker locale={locale} value={shot.screens ?? []} onChange={(screens) => setShot({ screens })} />
                <Field label={t('featureIds')}>
                  <ListInput value={shot.featureIds} placeholder="feature-id" onChange={(v) => setShot({ featureIds: v })} />
                </Field>
                <details className="advanced">
                  <summary>{t('shotTechnical')}</summary>
                  <div className="stack">
                    <div className="grid three">
                      <TextField label={t('slug')} value={shot.slug} mono onChange={(v) => setShot({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
                      <Field label={t('archetype')}>
                        <Select value={shot.archetype} onChange={(v) => setShot({ archetype: v })} options={o.enums.archetypes} />
                      </Field>
                      <Field label={t('framing')}>
                        <Select value={shot.framing ?? 'auto'} onChange={(v) => setShot({ framing: v })} options={o.enums.framings} />
                      </Field>
                    </div>
                    <div className="row wrap">
                      <Check checked={shot.captionPosition === 'bottom'} onChange={(on) => setShot({ captionPosition: on ? 'bottom' : 'top' })}>
                        {t('captionBottom')}
                      </Check>
                      <Check checked={Boolean(shot.inverted)} onChange={(on) => setShot({ inverted: on || undefined })}>
                        {t('inverted')}
                      </Check>
                      <Check checked={Boolean(shot.bridge)} onChange={(on) => setShot({ bridge: on })}>
                        {t('bridge')}
                      </Check>
                      <Check checked={Boolean(shot.brandMark)} onChange={(on) => setShot({ brandMark: on })}>
                        {t('brandMark')}
                      </Check>
                      <Field label={t('bulletStyle')}>
                        <Select value={shot.bulletStyle ?? 'check'} onChange={(v) => setShot({ bulletStyle: v as Shot['bulletStyle'] })} options={['check', 'chips']} />
                      </Field>
                    </div>
                    <div className="grid two">
                      <TextField label={t('photo')} value={shot.photo ?? ''} mono placeholder="metadata/photos/… (relative: scene.jpg)" onChange={(v) => setShot({ photo: v || undefined })} />
                      <TextField label={t('template')} value={shot.template ?? ''} mono placeholder="hero.html" onChange={(v) => setShot({ template: v || undefined })} />
                    </div>
                    <AdvancedJson shot={shot} onChange={(patch) => setShot(patch)} />
                  </div>
                </details>
                <SaveBar file={file} />
              </div>
            </Card>
          ) : (
            <Empty>{t('noShots')}</Empty>
          )}
          <div className="preview-pane stack">
            {shot && imageFor(shot.id) ? (
              <>
                <img src={fileUrl(imageFor(shot.id)!.path, state.changedTick)} alt="" onClick={() => setBig(fileUrl(imageFor(shot.id)!.path, state.changedTick))} style={{ cursor: 'zoom-in' }} />
                <div className="thumbs">
                  {rendered
                    .filter((f) => shot && f.name.startsWith(`${shot.id}_`))
                    .map((f) => (
                      <Thumb key={f.path} path={f.path} caption={f.name.replace(/^\d+_[a-z0-9-]+_/, '').replace(/\.png$/, '')} bust={state.changedTick} />
                    ))}
                </div>
              </>
            ) : (
              <Empty>{t('nothingYet')}</Empty>
            )}
          </div>
        </div>
      </div>
      {big && <Lightbox src={big} onClose={() => setBig(undefined)} />}
    </div>
  );
}

/** The app's screens as thumbnails: the ones this screenshot shows are marked, a click adds or removes one. */
function ScreenPicker({ locale, value, onChange }: { locale: string; value: string[]; onChange: (screens: string[]) => void }) {
  const { state } = useStudio();
  const o = state.overview!;
  const raw = o.raw[locale] ?? o.raw[Object.keys(o.raw)[0] ?? ''] ?? {};
  const family = raw.iphone ? 'iphone' : Object.keys(raw)[0];
  const ids = [...new Set([...o.config!.screens.map((s) => s.id), ...value])];
  return (
    <Field label={t('screensPick')}>
      <div className="screen-pick">
        {ids.map((id) => {
          const file = family ? raw[family]?.find((f) => f.name === `${id}.png`) : undefined;
          const n = value.indexOf(id);
          return (
            <button key={id} type="button" className={n >= 0 ? 'on' : ''} onClick={() => onChange(n >= 0 ? value.filter((x) => x !== id) : [...value, id])}>
              {file ? <img src={fileUrl(file.path, state.changedTick)} alt="" /> : <div className="ph" />}
              <span>
                {n >= 0 ? `${n + 1} · ` : ''}
                {id}
              </span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/** badges, callouts, quotes, wall, targets: the rarer fields, as JSON. */
function AdvancedJson({ shot, onChange }: { shot: Shot; onChange: (patch: Partial<Shot>) => void }) {
  const keys = ['badges', 'callouts', 'quotes', 'wall', 'stat', 'targets'] as const;
  const subset: Record<string, unknown> = {};
  for (const k of keys) if (shot[k] !== undefined) subset[k] = shot[k];
  const [text, setText] = useState(JSON.stringify(subset, null, 2));
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => setText(JSON.stringify(subset, null, 2)), [shot.id, JSON.stringify(subset)]);
  return (
    <Field label={t('advancedJson')}>
      <textarea
        className="input code"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const v = JSON.parse(text) as Record<string, unknown>;
            const patch: Record<string, unknown> = {};
            for (const k of keys) patch[k] = v[k];
            onChange(patch as Partial<Shot>);
            setErr(undefined);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      />
      {err && <span className="small" style={{ color: 'var(--err)' }}>{err}</span>}
    </Field>
  );
}

function newShot(id: string, locales: string[]): Shot {
  return { id, slug: `shot-${id}`, archetype: 'hero', screens: [], copy: Object.fromEntries(locales.map((l) => [l, { kicker: '', headline: 'Headline', subheadline: '' }])), featureIds: [], framing: 'auto' };
}

/** The iPhone target the set was rendered for, so the strip and the thumbnails show one format. */
function pickTarget(files: RenderedFile[]): string | undefined {
  const targets = new Set<string>();
  for (const f of files) {
    const m = /^\d{2}_[a-z0-9-]+_([a-z0-9.-]+)\.(png|jpe?g)$/i.exec(f.name);
    if (m) targets.add(m[1]!);
  }
  const list = [...targets];
  return list.find((x) => x.startsWith('iphone-6.3')) ?? list.find((x) => x.startsWith('iphone')) ?? list[0];
}
