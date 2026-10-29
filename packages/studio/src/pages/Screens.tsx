import { useState } from 'react';
import { api, fileUrl, startLocale } from '../api';
import { t } from '../i18n';
import { useBusy, useFile, useStudio } from '../store';
import { Button, Card, CodeEditor, Empty, Modal, Pill, Tabs, Thumb } from '../ui';

/** The app's screens: the HTML recreations, their renders per language and device, strings, and the mockups. */
export function Screens({ openClaude }: { openClaude: () => void }) {
  const { state, run, toast } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const cfg = o.config!;
  // Only the store locales: raw captures of a locale that is no longer selected are not part of this run.
  const locales = cfg.locales;
  const [locale, setLocale] = useState(startLocale(cfg));
  const [editing, setEditing] = useState<string | undefined>();
  const [stringsLocale, setStringsLocale] = useState<string | undefined>();
  const families = Object.keys(o.raw[locale] ?? {});
  const hasBrief = o.briefs.some((b) => b.name === 'screens');

  return (
    <div className="page">
      <header>
        <h2>{t('screens')}</h2>
        <p>{t('screensIntro')}</p>
      </header>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Button kind="primary" disabled={busy} onClick={() => run('capture')}>
          {t('renderScreens')}
        </Button>
        <Button disabled={busy} onClick={() => run('mockups', { screens: true })}>
          {t('renderMockups')}
        </Button>
        {o.mockups?.index && (
          <Button onClick={() => window.open(fileUrl(o.mockups!.index!), '_blank')}>
            {t('openMockups')}
          </Button>
        )}
        {hasBrief && (
          <Button
            kind="primary"
            disabled={busy || !o.claude.available}
            onClick={() =>
              api
                .askClaude({ stage: 'screens' })
                .then(openClaude)
                .catch((err) => toast((err as Error).message, 'err'))
            }
          >
            ✳ {t('askClaude')}
          </Button>
        )}
        <span className="grow" />
        {cfg.locales.map((l) => (
          <Button key={l} size="sm" kind={l === stringsLocale ? 'primary' : 'ghost'} onClick={() => setStringsLocale(l)}>
            {t('strings')} {l}
          </Button>
        ))}
      </div>
      {cfg.screens.length === 0 ? (
        <Empty>{t('noScreens')}</Empty>
      ) : (
        <>
          <Tabs tabs={locales.map((l) => ({ id: l, label: l }))} value={locale} onChange={setLocale} />
          <div className="stack">
            {cfg.screens.map((s) => (
              <Card
                key={s.id}
                title={
                  <span className="row">
                    <code>{s.id}</code>
                    {(s.source ?? []).map((f) => (
                      <span key={f} className="dim small mono">
                        {f}
                      </span>
                    ))}
                  </span>
                }
                actions={
                  <Button size="sm" onClick={() => setEditing(`metadata/screens/${s.id}.html`)}>
                    {s.id}.html
                  </Button>
                }
              >
                <div className="thumbs">
                  {families.length === 0 && <span className="dim small">{t('nothingYet')}</span>}
                  {families.map((fam) => {
                    const file = o.raw[locale]?.[fam]?.find((f) => f.name === `${s.id}.png`);
                    return file ? <Thumb key={fam} path={file.path} caption={fam} bust={state.changedTick} wide={['mac', 'tv', 'vision'].includes(fam)} /> : <Pill key={fam}>{fam}: —</Pill>;
                  })}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      {o.mockups && o.mockups.screens.length > 0 && (
        <Card title={t('mockups')} className="stack" >
          <div className="thumbs">
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
