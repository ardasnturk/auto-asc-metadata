import { useEffect, useState } from 'react';
import { api, type Overview } from '../api';
import { t } from '../i18n';
import { IssueList } from '../status';
import { useBusy, useFile, useStudio } from '../store';
import { Button, Card, CodeEditor, Empty, ListInput, Pill, SaveBar, Tabs, TextField, useMode, utf8Bytes } from '../ui';

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
  file?: string;
}

interface KeywordPlan {
  candidates: Array<{ term: string; total: number | null; popularity: { score: number }; competition: { score: number } }>;
}

const LIMITS = { name: 30, subtitle: 30, promotionalText: 170, keywords: 100, description: 4000, whatsNew: 4000, reviewNotes: 4000 } as const;
const URL_FIELDS = { supportUrl: 'support', marketingUrl: 'marketing', privacyUrl: 'privacy' } as const;
const isPlaceholder = (url?: string) => Boolean(url && /\bexample\.(com|org|net)\b/i.test(url));

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
        <Button kind="primary" disabled={busy} title="vitrin write" onClick={() => run('write')}>
          {t('writeAction')}
        </Button>
        <Button disabled={busy} title="vitrin research" onClick={() => run('research')}>
          {t('researchAction')}
        </Button>
        {hasBrief && (
          <Button kind="primary" disabled={busy || !o.claude.available} onClick={() => api.askClaude({ stage: 'write' }).then(openClaude).catch((err) => toast((err as Error).message, 'err'))}>
            ✳ {t('askClaude')}
          </Button>
        )}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === '__app' ? (
        <AppForm issues={issues.filter((i) => !i.locale)} o={o} />
      ) : tab === '__play' ? (
        <PlayEditor locales={cfg.locales} />
      ) : (
        <LocaleForm key={tab} locale={tab} issues={issues.filter((i) => i.locale === tab || i.file === `metadata/listing/${tab}.json`)} urls={cfg.urls} onEditUrls={() => setTab('__app')} />
      )}
    </div>
  );
}

function LocaleForm({ locale, issues, urls, onEditUrls }: { locale: string; issues: Issue[]; urls: NonNullable<Overview['config']>['urls']; onEditUrls: () => void }) {
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
  const general = issues.filter((i) => !i.field || !(i.field in LIMITS || i.field in URL_FIELDS));
  // A placeholder URL comes from the config unless this language sets its own: fix it where it lives.
  const fixUrl = (i: Issue) => {
    const field = i.field as keyof typeof URL_FIELDS | undefined;
    if (!field || !(field in URL_FIELDS)) return null;
    return (
      <div>
        <Button size="sm" kind="ghost" onClick={() => (d?.[field] ? document.getElementById(`url-${field}`)?.focus() : onEditUrls())}>
          {t('fixIt')} →
        </Button>
      </div>
    );
  };
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
            <TextField label={t('fieldKeywords')} value={d.keywords} max={LIMITS.keywords} unit="bytes" mono onChange={(v) => set('keywords', v)} hint={t('keywordsHint')} />
            <KeywordChips locale={locale} used={[d.keywords, d.name, d.subtitle ?? '']} keywords={d.keywords} onAdd={(v) => set('keywords', v)} />
            <IssueList issues={forField('keywords')} />
            <TextField label={t('fieldPromo')} value={d.promotionalText ?? ''} max={LIMITS.promotionalText} multiline rows={3} onChange={(v) => set('promotionalText', v)} />
            <IssueList issues={forField('promotionalText')} />
            <TextField label={t('fieldDescription')} value={d.description} max={LIMITS.description} multiline rows={12} onChange={(v) => set('description', v)} />
            <IssueList issues={forField('description')} />
            <TextField label={t('fieldWhatsNew')} value={d.whatsNew ?? ''} max={LIMITS.whatsNew} multiline rows={5} onChange={(v) => set('whatsNew', v)} />
            <IssueList issues={forField('whatsNew')} />
            <div className="grid three">
              {(
                [
                  ['supportUrl', 'fieldSupport'],
                  ['marketingUrl', 'fieldMarketing'],
                  ['privacyUrl', 'fieldPrivacy'],
                ] as const
              ).map(([field, label]) => (
                <div key={field} className="field">
                  <label>{t(label)}</label>
                  <input id={`url-${field}`} className="input mono" value={d[field] ?? ''} placeholder={urls[URL_FIELDS[field]] ? t('urlFromConfig', { url: urls[URL_FIELDS[field]]! }) : ''} onChange={(e) => set(field, e.target.value || undefined)} />
                </div>
              ))}
            </div>
            <IssueList issues={issues.filter((i) => i.field && i.field in URL_FIELDS)} action={fixUrl} />
            <ClaimsEditor claims={d.claims ?? []} onChange={(claims) => set('claims', claims)} />
            <SaveBar file={file} />
          </div>
        )}
      </Card>
      <div className="stack">
        <Card title={`${t('issuesTitle')} · ${issues.length}`}>
          {issues.length === 0 ? <span className="dim small">{t('nothingYet')}</span> : <IssueList issues={general.length ? general : issues} action={fixUrl} />}
        </Card>
      </div>
    </div>
  );
}

function ClaimsEditor({ claims, onChange }: { claims: Claim[]; onChange: (c: Claim[]) => void }) {
  return (
    <Card title={t('claimsTitle')} className="tight" actions={<Button size="sm" onClick={() => onChange([...claims, { text: '', featureIds: [] }])}>+</Button>}>
      <div className="stack">
        {claims.length === 0 && <span className="dim small">{t('claimsHint')}</span>}
        {claims.map((c, i) => (
          <div key={i} className="row">
            <input className="input grow" value={c.text} placeholder={t('claimPlaceholder')} onChange={(e) => onChange(claims.map((x, n) => (n === i ? { ...x, text: e.target.value } : x)))} />
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

/** The research's best keywords that are not in the name, subtitle or keyword field yet: one click adds one. */
function KeywordChips({ locale, used, keywords, onAdd }: { locale: string; used: string[]; keywords: string; onAdd: (value: string) => void }) {
  const plan = useFile<KeywordPlan>(`metadata/research/keywords/${locale}.json`);
  const { toast } = useStudio();
  const have = used.join(' ').toLocaleLowerCase(locale);
  const score = (c: KeywordPlan['candidates'][number]) => c.total ?? c.popularity.score * (1 - c.competition.score) - 1;
  const terms = (plan.data?.candidates ?? [])
    .slice()
    .sort((a, b) => score(b) - score(a))
    .map((c) => c.term)
    .filter((term) => !term.toLocaleLowerCase(locale).split(/\s+/).every((w) => have.includes(w)))
    .slice(0, 12);
  if (!terms.length) return null;
  const add = (term: string) => {
    const next = keywords.trim() ? `${keywords.trim().replace(/,+$/, '')},${term}` : term;
    if (utf8Bytes(next) > LIMITS.keywords) toast(t('keywordNoRoom', { term }), 'err');
    else onAdd(next);
  };
  return (
    <div className="stack tight">
      <span className="dim small">{t('suggestedKeywords')}</span>
      <div className="row wrap">
        {terms.map((term) => (
          <Button key={term} size="sm" kind="ghost" className="chip" onClick={() => add(term)}>
            + {term}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** urls.* in vitrin.config.yaml: one place for every language, saved with vitrin select. */
function UrlsCard({ o }: { o: Overview }) {
  const { run } = useStudio();
  const busy = useBusy();
  const saved = o.config!.urls;
  const [draft, setDraft] = useState(saved);
  const key = JSON.stringify(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(saved), [key]);
  const fields = [
    ['support', 'fieldSupport'],
    ['privacy', 'fieldPrivacy'],
    ['marketing', 'fieldMarketing'],
  ] as const;
  const args = Object.fromEntries(fields.filter(([k]) => (draft[k] ?? '') !== (saved[k] ?? '')).map(([k]) => [`${k}Url`, draft[k] ?? '']));
  return (
    <Card title={t('urlsTitle')}>
      <div className="stack">
        <div className="dim small">{t('urlsHint')}</div>
        <div className="grid three">
          {fields.map(([k, label]) => (
            <div key={k} className="field">
              <label>
                {t(label)} {isPlaceholder(draft[k]) && <Pill tone="err">{t('placeholderUrl')}</Pill>}
              </label>
              <input className="input mono" value={draft[k] ?? ''} placeholder="https://" onChange={(e) => setDraft({ ...draft, [k]: e.target.value || undefined })} />
            </div>
          ))}
        </div>
        <div className="row">
          <Button kind="primary" disabled={busy || !Object.keys(args).length} title="vitrin select" onClick={() => run('select', args)}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AppForm({ issues, o }: { issues: Issue[]; o: Overview }) {
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
    <div className="stack">
      <UrlsCard o={o} />
      <Card title={t('appLevel')} actions={toggle}>
        {mode === 'json' || !d ? (
          <CodeEditor file={file} />
        ) : (
          <div className="stack">
            <div className="grid three">
              <TextField label={t('copyright')} value={d.copyright} onChange={(v) => set('copyright', v)} />
              <TextField label={t('primaryCategory')} value={d.primaryCategory} mono onChange={(v) => set('primaryCategory', v)} hint={t('primaryCategoryHint')} />
              <TextField label={t('secondaryCategory')} value={d.secondaryCategory ?? ''} mono onChange={(v) => set('secondaryCategory', v || undefined)} />
            </div>
            <TextField label={t('reviewNotes')} value={d.reviewNotes ?? ''} max={LIMITS.reviewNotes} unit="bytes" multiline rows={5} onChange={(v) => set('reviewNotes', v)} />
            <IssueList issues={issues} />
            <SaveBar file={file} />
          </div>
        )}
      </Card>
    </div>
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
            <TextField label={t('playTitle')} value={str('title')} max={30} onChange={(v) => set('title', v)} />
            <TextField label={t('playShort')} value={str('shortDescription')} max={80} multiline rows={2} onChange={(v) => set('shortDescription', v)} />
            <TextField label={t('playFull')} value={str('fullDescription')} max={4000} multiline rows={10} onChange={(v) => set('fullDescription', v)} />
          </>
        )}
        <CodeEditor file={file} rows={d && 'title' in d ? 10 : 20} />
      </div>
    </Card>
  );
}
