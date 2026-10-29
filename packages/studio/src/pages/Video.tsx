import { useState } from 'react';
import { api, fileUrl, startLocale } from '../api';
import { t } from '../i18n';
import { useBusy, useFile, useStudio } from '../store';
import { BlockerItem, blockerText } from '../status';
import { Button, Card, CodeEditor, Empty, Field, ListInput, SaveBar, Select, Tabs, TextField, useMode } from '../ui';

/** The video plan (previews, beats, loops), the four-style comparison and the rendered App Previews. */

type Localized = Record<string, string>;
interface Beat {
  scene?: string;
  source?: string;
  from?: number;
  to: number;
  caption: Localized;
  featureIds: string[];
  [k: string]: unknown;
}
interface Preview {
  id: string;
  device: 'iphone' | 'ipad' | 'mac' | 'tv' | 'vision';
  style?: string;
  transition?: string;
  hook: Localized;
  hookSource: string;
  hookFrom?: number;
  beats: Beat[];
  outro?: { title: Localized; subtitle?: Localized; source?: string };
  [k: string]: unknown;
}
interface VideoPlan {
  previews: Preview[];
  loops?: Record<string, unknown>;
}

export function Video({ openClaude }: { openClaude: () => void }) {
  const { state, run, toast } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const cfg = o.config!;
  const [locale, setLocale] = useState(startLocale(cfg));
  const file = useFile<VideoPlan>('metadata/video-plan.json');
  const [mode, toggle] = useMode();
  const hasBrief = o.briefs.some((b) => b.name === 'video');
  const d = file.data;
  const screens = cfg.screens.map((s) => s.id);

  const setPreview = (i: number, patch: Partial<Preview>) => d && file.setData({ ...d, previews: d.previews.map((p, n) => (n === i ? { ...p, ...patch } : p)) });
  // Rendering needs ffmpeg; editing the plan does not.
  const ffmpeg = o.blockers.find((b) => b.code === 'ffmpeg-missing');
  const renderLock = ffmpeg ? blockerText(ffmpeg) : undefined;

  return (
    <div className="page">
      <header>
        <h2>{t('video')}</h2>
        <p>{t('videoIntro')}</p>
      </header>
      {ffmpeg && (
        <div style={{ marginBottom: 14 }}>
          <BlockerItem blocker={ffmpeg} />
        </div>
      )}
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Button kind="primary" disabled={busy || Boolean(ffmpeg)} title={renderLock ?? 'vitrin video'} onClick={() => run('video')}>
          {t('renderVideo')}
        </Button>
        <Button disabled={busy || Boolean(ffmpeg)} title={renderLock ?? 'vitrin video --styles all'} onClick={() => run('video', { styles: ['all'], locales: [locale] })}>
          {t('compareStyles')}
        </Button>
        {hasBrief && (
          <Button kind="primary" disabled={busy || !o.claude.available} onClick={() => api.askClaude({ stage: 'video' }).then(openClaude).catch((err) => toast((err as Error).message, 'err'))}>
            ✳ {t('askClaude')}
          </Button>
        )}
        <span className="grow" />
        {state.remotion.running ? (
          <>
            {state.remotion.url && (
              <Button kind="primary" onClick={() => window.open(state.remotion.url, '_blank')}>
                {t('remotionStudio')} ↗
              </Button>
            )}
            <Button kind="danger" onClick={() => api.stopRemotion().catch((err) => toast((err as Error).message, 'err'))}>
              {t('remotionStop')}
            </Button>
          </>
        ) : o.remotion.available ? (
          <Button disabled={busy} onClick={() => api.startRemotion(locale).catch((err) => toast((err as Error).message, 'err'))}>
            {t('remotionOpen')}
          </Button>
        ) : (
          <span className="dim small" style={{ maxWidth: 360 }}>
            {t('remotionDevOnly')}
          </span>
        )}
      </div>
      <Tabs tabs={cfg.locales.map((l) => ({ id: l, label: l }))} value={locale} onChange={setLocale} />
      <div className="video-wrap">
        <div className="video-grid">
          <div className="stack">
            <div className="row">
              <h3 className="grow">{t('previews')}</h3>
              {toggle}
            </div>
            {file.loading ? (
              <span className="dim">{t('loading')}</span>
            ) : !d || mode === 'json' ? (
              !file.exists && !file.dirty ? (
                <Empty>
                  <p style={{ marginBottom: 10 }}>{t('noVideoPlan')}</p>
                  <Button onClick={() => file.setData({ previews: [{ id: '01', device: 'iphone', style: 'showcase', hook: Object.fromEntries(cfg.locales.map((l) => [l, 'Hook'])), hookSource: screens[0] ?? 'home', beats: [{ scene: 'device', source: screens[0] ?? 'home', from: 0, to: 2.5, caption: Object.fromEntries(cfg.locales.map((l) => [l, 'Caption'])), featureIds: [] }] }], loops: {} })}>
                    {t('startEmpty')}
                  </Button>
                </Empty>
              ) : (
                <CodeEditor file={file} />
              )
            ) : (
              <>
                {d.previews.map((p, i) => (
                  <Card
                    key={p.id}
                    title={
                      <span>
                        {p.id} · {p.device}
                      </span>
                    }
                    actions={
                      <Button size="sm" kind="ghost" disabled={d.previews.length <= 1} onClick={() => file.setData({ ...d, previews: d.previews.filter((_, n) => n !== i) })}>
                        ✕
                      </Button>
                    }
                  >
                    <div className="stack">
                      <div className="grid three">
                        <Field label={t('device')}>
                          <Select value={p.device} onChange={(v) => setPreview(i, { device: v as Preview['device'] })} options={['iphone', 'ipad', 'mac', 'tv', 'vision']} />
                        </Field>
                        <Field label={t('style')}>
                          <Select value={p.style ?? 'showcase'} onChange={(v) => setPreview(i, { style: v })} options={o.enums.videoStyles} />
                        </Field>
                        <Field label={t('transition')}>
                          <Select value={p.transition ?? 'auto'} onChange={(v) => setPreview(i, { transition: v })} options={o.enums.transitions} />
                        </Field>
                      </div>
                      <div className="grid three">
                        <div style={{ gridColumn: 'span 2' }}>
                          <TextField label={`${t('hook')} · ${locale}`} value={p.hook[locale] ?? ''} onChange={(v) => setPreview(i, { hook: { ...p.hook, [locale]: v } })} />
                        </div>
                        <Field label={t('hookSource')}>
                          <Select value={p.hookSource} onChange={(v) => setPreview(i, { hookSource: v })} options={[...new Set([...screens, p.hookSource])]} />
                        </Field>
                      </div>
                      <Timeline preview={p} locale={locale} />
                      <div className="row">
                        <b className="grow">{t('beats')}</b>
                        <Button size="sm" disabled={p.beats.length >= 8} onClick={() => setPreview(i, { beats: [...p.beats, { scene: 'device', source: screens[0] ?? '', from: 0, to: 2, caption: { [locale]: '' }, featureIds: [] }] })}>
                          + {t('addBeat')}
                        </Button>
                      </div>
                      <div className="dim small">{t('beatTimesHint')}</div>
                      {p.beats.map((b, j) => {
                        const setBeat = (patch: Partial<Beat>) => setPreview(i, { beats: p.beats.map((x, n) => (n === j ? { ...x, ...patch } : x)) });
                        return (
                          <div key={j} className="beat">
                            <Select value={b.scene ?? 'device'} onChange={(v) => setBeat({ scene: v })} options={o.enums.scenes} />
                            <div className="stack" style={{ gap: 4 }}>
                              <input className="input" placeholder={`${t('caption')} (${locale})`} value={b.caption?.[locale] ?? ''} onChange={(e) => setBeat({ caption: { ...(b.caption ?? {}), [locale]: e.target.value } })} />
                              <div className="row">
                                <Select value={b.source ?? ''} onChange={(v) => setBeat({ source: v })} options={[...new Set([...screens, b.source ?? ''])].filter(Boolean)} allowEmpty={t('beatSource')} />
                                <ListInput value={b.featureIds ?? []} placeholder={t('featureIdsPlaceholder')} onChange={(v) => setBeat({ featureIds: v })} />
                              </div>
                            </div>
                            <label className="mini">
                              {t('beatStart')}
                              <input className="input mono" type="number" step="0.1" min="0" value={b.from ?? 0} onChange={(e) => setBeat({ from: Number(e.target.value) })} />
                            </label>
                            <label className="mini">
                              {t('beatEnd')}
                              <input className="input mono" type="number" step="0.1" min="0.1" value={b.to} onChange={(e) => setBeat({ to: Number(e.target.value) })} />
                            </label>
                            <Button size="sm" kind="ghost" disabled={p.beats.length <= 1} onClick={() => setPreview(i, { beats: p.beats.filter((_, n) => n !== j) })}>
                              ✕
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ))}
                {d.previews.length < 3 && (
                  <Button onClick={() => file.setData({ ...d, previews: [...d.previews, { id: String(d.previews.length + 1).padStart(2, '0'), device: 'iphone', style: 'showcase', hook: { [locale]: '' }, hookSource: screens[0] ?? '', beats: [{ scene: 'device', source: screens[0] ?? '', from: 0, to: 2.5, caption: { [locale]: '' }, featureIds: [] }] }] })}>
                    + {t('addPreview')}
                  </Button>
                )}
                <SaveBar file={file} />
              </>
            )}
          </div>
          <div className="stack">
            <Card title={`${t('previews')} · ${locale}`}>
              <Players files={o.previews[locale] ?? []} bust={state.changedTick} />
            </Card>
            <Card title={`${t('compareStyles')} · ${locale}`}>
              <Players files={o.videoStyles[locale] ?? []} bust={state.changedTick} />
            </Card>
            {Object.values(o.creatives).some((f) => f.some((x) => /\.(mp4|mov|m4v)$/i.test(x.name))) && (
              <Card title={t('creatives')}>
                <Players files={(o.creatives[locale] ?? []).filter((x) => /\.(mp4|mov|m4v)$/i.test(x.name))} bust={state.changedTick} />
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The renderer's fixed parts (packages/video: HOOK_SEC, OUTRO_SEC).
const HOOK_SEC = 2.2;
const OUTRO_SEC = 2.4;

/** The preview as it plays: the hook, each scene as long as it lasts, the closing line, and the total against 15–30 s. */
function Timeline({ preview, locale }: { preview: Preview; locale: string }) {
  const beats = preview.beats.map((b) => ({ sec: Math.max(0, (b.to ?? 0) - (b.from ?? 0)), label: b.caption?.[locale] || b.scene || '' }));
  const parts = [{ sec: HOOK_SEC, label: preview.hook[locale] || t('hook'), kind: 'hook' }, ...beats.map((b) => ({ ...b, kind: 'beat' })), ...(preview.outro ? [{ sec: OUTRO_SEC, label: t('outro'), kind: 'outro' }] : [])];
  const total = parts.reduce((s, p) => s + p.sec, 0);
  const fits = total >= 15 && total <= 30;
  return (
    <div className="stack tight">
      <div className="timeline">
        {parts.map((p, i) => (
          <div key={i} className={`seg ${p.kind}`} style={{ flexGrow: Math.max(p.sec, 0.3) }} title={`${p.label} · ${p.sec.toFixed(1)} ${t('seconds')}`}>
            <span>{p.label}</span>
            <small>{p.sec.toFixed(1)}</small>
          </div>
        ))}
      </div>
      <div className={`small ${fits ? 'dim' : 'text-err'}`}>
        {t('timelineTotal', { total: total.toFixed(1) })}
        {fits ? '' : ` · ${t('timelineFit')}`}
      </div>
    </div>
  );
}

function Players({ files, bust }: { files: Array<{ path: string; name: string }>; bust: number }) {
  if (!files.length) return <span className="dim small">{t('nothingYet')}</span>;
  return (
    <div className="players">
      {files.map((f) => (
        <div key={f.path}>
          <video src={fileUrl(f.path, bust)} controls muted preload="metadata" />
          <div className="cap">{f.name}</div>
        </div>
      ))}
    </div>
  );
}
