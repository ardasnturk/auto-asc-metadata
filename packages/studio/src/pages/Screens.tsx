import { useState } from 'react';
import { api, fileUrl, startLocale } from '../api';
import { t } from '../i18n';
import { useBusy, useCli, useFile, useStudio } from '../store';
import { Button, Card, CodeEditor, Empty, Modal, Tabs, Thumb } from '../ui';

/** The app's screens as a gallery per language and device; the HTML, its source files and strings sit under Advanced. */
export function Screens({ openClaude }: { openClaude: () => void }) {
  const { state, run, toast } = useStudio();
  const busy = useBusy();
  const cli = useCli();
  const o = state.overview!;
  const cfg = o.config!;
  // Only the store locales: raw captures of a locale that is no longer selected are not part of this run.
  const locales = cfg.locales;
  const [locale, setLocale] = useState(startLocale(cfg));
  const [editing, setEditing] = useState<string | undefined>();
  const [stringsLocale, setStringsLocale] = useState<string | undefined>();
  const families = Object.keys(o.raw[locale] ?? {});
  const [family, setFamily] = useState<string | undefined>();
  const fam = family && families.includes(family) ? family : families.includes('iphone') ? 'iphone' : families[0];
  const hasBrief = o.briefs.some((b) => b.name === 'screens');
  const wide = (f?: string) => ['mac', 'tv', 'vision'].includes(f ?? '');

  return (
    <div className="page">
      <header>
        <h2>{t('screens')}</h2>
        <p>{t('screensIntro')}</p>
      </header>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {hasBrief && (
          <Button kind="primary" disabled={busy || !o.claude.available} onClick={() => api.askClaude({ stage: 'screens' }).then(openClaude).catch((err) => toast((err as Error).message, 'err'))}>
            ✳ {t('askClaude')}
          </Button>
        )}
        <Button kind={hasBrief ? undefined : 'primary'} disabled={busy} title={cli('vitrin capture')} onClick={() => run('capture')}>
          {t('renderScreens')}
        </Button>
        <Button disabled={busy} title={cli('vitrin mockups --screens')} onClick={() => run('mockups', { screens: true })}>
          {t('renderMockups')}
        </Button>
        {o.mockups?.index && (
          <Button kind="ghost" onClick={() => window.open(fileUrl(o.mockups!.index!), '_blank')}>
            {t('openMockups')}
          </Button>
        )}
      </div>
      {cfg.screens.length === 0 ? (
        <Empty>{t('noScreens')}</Empty>
      ) : (
        <>
          <Tabs tabs={locales.map((l) => ({ id: l, label: l }))} value={locale} onChange={setLocale} />
          {families.length > 1 && (
            <div className="row wrap" style={{ marginBottom: 10 }}>
              {families.map((f) => (
                <Button key={f} size="sm" kind={f === fam ? 'primary' : 'ghost'} onClick={() => setFamily(f)}>
                  {f}
                </Button>
              ))}
            </div>
          )}
          <div className="gallery">
            {cfg.screens.map((s) => {
              const file = fam ? o.raw[locale]?.[fam]?.find((f) => f.name === `${s.id}.png`) : undefined;
              return file ? (
                <Thumb key={s.id} path={file.path} caption={s.id} bust={state.changedTick} large wide={wide(fam)} />
              ) : (
                <div key={s.id} className={`thumb lg missing ${wide(fam) ? 'wide' : ''}`}>
                  <div className="placeholder">{t('notRenderedYet')}</div>
                  <div className="cap">{s.id}</div>
                </div>
              );
            })}
          </div>
          <details className="advanced">
            <summary>{t('advanced')}</summary>
            <div className="stack">
              <div className="dim small">{t('screensAdvancedHint')}</div>
              <table className="plain">
                <tbody>
                  {cfg.screens.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <code>{s.id}</code>
                      </td>
                      <td className="dim small mono">{(s.source ?? []).join(', ') || '—'}</td>
                      <td>
                        <Button size="sm" kind="ghost" onClick={() => setEditing(`metadata/screens/${s.id}.html`)}>
                          {t('editHtml')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row wrap">
                <span className="dim small">{t('strings')}:</span>
                {cfg.locales.map((l) => (
                  <Button key={l} size="sm" kind="ghost" onClick={() => setStringsLocale(l)}>
                    {l}
                  </Button>
                ))}
              </div>
            </div>
          </details>
        </>
      )}
      {o.mockups && o.mockups.screens.length > 0 && (
        <Card title={t('mockups')} className="stack">
          <div className="gallery">
            {o.mockups.screens.slice(0, 24).map((f) => (
              <Thumb key={f.path} path={f.path} caption={f.name} bust={state.changedTick} large wide />
            ))}
          </div>
        </Card>
      )}
      {editing && <FileModal path={editing} onClose={() => setEditing(undefined)} />}
      {stringsLocale && <FileModal path={`metadata/screens/strings/${stringsLocale}.json`} onClose={() => setStringsLocale(undefined)} json />}
    </div>
  );
}

export function FileModal({ path, onClose, json }: { path: string; onClose: () => void; json?: boolean }) {
  const file = useFile<unknown>(path, { json: Boolean(json) });
  return (
    <Modal title={<code>{path}</code>} onClose={onClose} wide>
      {file.loading ? <span className="dim">{t('loading')}</span> : <CodeEditor file={file} rows={28} />}
    </Modal>
  );
}
