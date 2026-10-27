import { useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useBusy, useFile, useStudio } from '../store';
import { Button, Card, CodeEditor, Empty, ListInput, SaveBar, Tabs, TextField, useMode } from '../ui';

/** The store text per language with App Store Connect counters, app-level fields and the validation issues inline. */

interface Claim {
  text: string;
  featureIds: string[];
}
interface LocaleMetadata {
  locale: string;
  name: string;
  subtitle?: string;
  promotionalText?: string;
  description: string;
  keywords: string;
  whatsNew?: string;
  supportUrl?: string;
  marketingUrl?: string;
  privacyUrl?: string;
  claims?: Claim[];
  notes?: string;
}
interface AppMetadata {
  copyright: string;
  primaryCategory: string;
  secondaryCategory?: string;
  primarySubcategories?: string[];
  secondarySubcategories?: string[];
  reviewNotes?: string;
  [k: string]: unknown;
}
interface Issue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix?: string;
  locale?: string;
  field?: string;
}

const LIMITS = { name: 30, subtitle: 30, promotionalText: 170, keywords: 100, description: 4000, whatsNew: 4000, reviewNotes: 4000 } as const;

export function Metadata({ openClaude }: { openClaude: () => void }) {
  const { state, run, toast } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  const cfg = o.config!;
  const tabs = [...cfg.locales.map((l) => ({ id: l, label: l })), { id: '__app', label: t('appLevel') }, ...(o.playListing.length || o.app?.platforms.includes('android') ? [{ id: '__play', label: t('playListing') }] : [])];
  const [tab, setTab] = useState(tabs[0]!.id);
  const validation = useFile<{ issues: Issue[] }>(o.files.validation ? 'metadata/validation.json' : undefined);
  const issues = validation.data?.issues ?? [];
  const hasBrief = o.briefs.some((b) => b.name === 'write');

  return (
    <div className="page">
      <header>
        <h2>{t('metadata')}</h2>
        <p>{t('metadataIntro')}</p>
      </header>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Button kind="primary" disabled={busy} onClick={() => run('write')}>
          vitrin write
        </Button>
        <Button disabled={busy} onClick={() => run('research')}>
          vitrin research
        </Button>
        {hasBrief && (
          <Button kind="primary" disabled={busy || !o.claude.available} onClick={() => api.askClaude({ stage: 'write' }).then(openClaude).catch((err) => toast((err as Error).message, 'err'))}>
            ✳ {t('askClaude')}
          </Button>
        )}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === '__app' ? <AppForm issues={issues.filter((i) => !i.locale)} /> : tab === '__play' ? <PlayEditor locales={cfg.locales} /> : <LocaleForm key={tab} locale={tab} issues={issues.filter((i) => i.locale === tab)} />}
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={n} className={i.severity}>
          <code>{i.code}</code> {i.message}
          {i.fix && <div className="dim">→ {i.fix}</div>}
        </li>
      ))}
    </ul>
  );
}

function LocaleForm({ locale, issues }: { locale: string; issues: Issue[] }) {
  const file = useFile<LocaleMetadata>(`metadata/listing/${locale}.json`);
  const [mode, toggle] = useMode();
  if (file.loading) return <span className="dim">{t('loading')}</span>;
  if (!file.exists && !file.dirty) {
    return (
      <Empty>
        <p style={{ marginBottom: 10 }}>{t('noMetadata')}</p>
        <Button onClick={() => file.setData({ locale, name: '', subtitle: '', promotionalText: '', description: '', keywords: '', whatsNew: '', claims: [] })}>{t('startEmpty')}</Button>
      </Empty>
    );
  }
  const d = file.data;
  const set = <K extends keyof LocaleMetadata>(k: K, v: LocaleMetadata[K]) => d && file.setData({ ...d, [k]: v });
  const forField = (f: string) => issues.filter((i) => i.field === f);
  const general = issues.filter((i) => !i.field || !(i.field in LIMITS || ['supportUrl', 'marketingUrl', 'privacyUrl'].includes(i.field)));
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px' }}>
      <Card title={locale} actions={toggle}>
        {mode === 'json' || !d ? (
          <CodeEditor file={file} />
        ) : (
          <div className="stack">
            <div className="grid two">
              <div>
                <TextField label={t('fieldName')} value={d.name} max={LIMITS.name} onChange={(v) => set('name', v)} />
                <IssueList issues={forField('name')} />
              </div>
              <div>
                <TextField label={t('fieldSubtitle')} value={d.subtitle ?? ''} max={LIMITS.subtitle} onChange={(v) => set('subtitle', v)} />
                <IssueList issues={forField('subtitle')} />
              </div>
            </div>
            <TextField label={t('fieldKeywords')} value={d.keywords} max={LIMITS.keywords} unit="bytes" mono onChange={(v) => set('keywords', v)} hint="comma-separated, no spaces after commas" />
            <IssueList issues={forField('keywords')} />
            <TextField label={t('fieldPromo')} value={d.promotionalText ?? ''} max={LIMITS.promotionalText} multiline rows={3} onChange={(v) => set('promotionalText', v)} />
            <IssueList issues={forField('promotionalText')} />
            <TextField label={t('fieldDescription')} value={d.description} max={LIMITS.description} multiline rows={12} onChange={(v) => set('description', v)} />
            <IssueList issues={forField('description')} />
            <TextField label={t('fieldWhatsNew')} value={d.whatsNew ?? ''} max={LIMITS.whatsNew} multiline rows={5} onChange={(v) => set('whatsNew', v)} />
            <IssueList issues={forField('whatsNew')} />
            <div className="grid three">
              <TextField label={t('fieldSupport')} value={d.supportUrl ?? ''} onChange={(v) => set('supportUrl', v || undefined)} />
              <TextField label={t('fieldMarketing')} value={d.marketingUrl ?? ''} onChange={(v) => set('marketingUrl', v || undefined)} />
              <TextField label={t('fieldPrivacy')} value={d.privacyUrl ?? ''} onChange={(v) => set('privacyUrl', v || undefined)} />
            </div>
            <ClaimsEditor claims={d.claims ?? []} onChange={(claims) => set('claims', claims)} />
            <SaveBar file={file} />
          </div>
        )}
      </Card>
      <div className="stack">
        <Card title={`${t('review')} · ${issues.length}`}>
          {issues.length === 0 ? <span className="dim small">{t('nothingYet')}</span> : <IssueList issues={general.length ? general : issues} />}
        </Card>
      </div>
    </div>
  );
}

function ClaimsEditor({ claims, onChange }: { claims: Claim[]; onChange: (c: Claim[]) => void }) {
  return (
    <Card title="Claims" className="tight" actions={<Button size="sm" onClick={() => onChange([...claims, { text: '', featureIds: [] }])}>+</Button>}>
      <div className="stack">
        {claims.length === 0 && <span className="dim small">Sentences that make a product claim, each tied to feature ids from app_profile.json.</span>}
        {claims.map((c, i) => (
          <div key={i} className="row">
            <input className="input grow" value={c.text} placeholder="claim text" onChange={(e) => onChange(claims.map((x, n) => (n === i ? { ...x, text: e.target.value } : x)))} />
            <div style={{ width: 260 }}>
              <ListInput value={c.featureIds} placeholder="feature-id, other-id" onChange={(ids) => onChange(claims.map((x, n) => (n === i ? { ...x, featureIds: ids } : x)))} />
            </div>
            <Button size="sm" kind="ghost" onClick={() => onChange(claims.filter((_, n) => n !== i))}>
              ✕
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AppForm({ issues }: { issues: Issue[] }) {
  const file = useFile<AppMetadata>('metadata/listing/app.json');
  const [mode, toggle] = useMode();
  if (file.loading) return <span className="dim">{t('loading')}</span>;
  if (!file.exists && !file.dirty) {
    return (
      <Empty>
        <p style={{ marginBottom: 10 }}>{t('noMetadata')}</p>
        <Button onClick={() => file.setData({ copyright: `${new Date().getFullYear()} `, primaryCategory: '', reviewNotes: '' })}>{t('startEmpty')}</Button>
      </Empty>
    );
  }
  const d = file.data;
  const set = (k: string, v: unknown) => d && file.setData({ ...d, [k]: v });
  return (
    <Card title={t('appLevel')} actions={toggle}>
      {mode === 'json' || !d ? (
        <CodeEditor file={file} />
      ) : (
        <div className="stack">
          <div className="grid three">
            <TextField label={t('copyright')} value={d.copyright} onChange={(v) => set('copyright', v)} />
            <TextField label={t('primaryCategory')} value={d.primaryCategory} mono onChange={(v) => set('primaryCategory', v)} hint="ASC constant, e.g. HEALTH_AND_FITNESS" />
            <TextField label={t('secondaryCategory')} value={d.secondaryCategory ?? ''} mono onChange={(v) => set('secondaryCategory', v || undefined)} />
          </div>
          <TextField label={t('reviewNotes')} value={d.reviewNotes ?? ''} max={LIMITS.reviewNotes} unit="bytes" multiline rows={5} onChange={(v) => set('reviewNotes', v)} />
          <IssueList issues={issues} />
          <SaveBar file={file} />
        </div>
      )}
    </Card>
  );
}

function PlayEditor({ locales }: { locales: string[] }) {
  const [tab, setTab] = useState(locales[0] ?? 'app');
  return (
    <div className="stack">
      <Tabs tabs={[...locales.map((l) => ({ id: l, label: l })), { id: 'app', label: 'app.json' }]} value={tab} onChange={setTab} />
      <PlayFile key={tab} path={tab === 'app' ? 'metadata/listing/play/app.json' : `metadata/listing/play/${tab}.json`} />
    </div>
  );
}

function PlayFile({ path }: { path: string }) {
  const file = useFile<Record<string, unknown>>(path);
  if (file.loading) return <span className="dim">{t('loading')}</span>;
  const d = file.data;
  const str = (k: string) => (typeof d?.[k] === 'string' ? (d[k] as string) : '');
  const set = (k: string, v: string) => d && file.setData({ ...d, [k]: v });
  return (
    <Card title={<code>{path}</code>}>
      <div className="stack">
        {d && 'title' in d && (
          <>
            <TextField label="Title" value={str('title')} max={30} onChange={(v) => set('title', v)} />
            <TextField label="Short description" value={str('shortDescription')} max={80} multiline rows={2} onChange={(v) => set('shortDescription', v)} />
            <TextField label="Full description" value={str('fullDescription')} max={4000} multiline rows={10} onChange={(v) => set('fullDescription', v)} />
          </>
        )}
        <CodeEditor file={file} rows={d && 'title' in d ? 10 : 20} />
      </div>
    </Card>
  );
}
