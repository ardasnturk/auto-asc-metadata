import { useEffect, useState } from 'react';
import { fileUrl } from './api';
import { ClaudePanel } from './ClaudePanel';
import { Console } from './Console';
import { t } from './i18n';
import { Design } from './pages/Design';
import { Metadata } from './pages/Metadata';
import { Pipeline } from './pages/Pipeline';
import { Review } from './pages/Review';
import { Screens } from './pages/Screens';
import { Setup } from './pages/Setup';
import { Upload } from './pages/Upload';
import { Video } from './pages/Video';
import { pendingDecisions } from './status';
import { useBusy, useStudio } from './store';
import { Button, Empty } from './ui';

export type Route = 'pipeline' | 'setup' | 'screens' | 'metadata' | 'design' | 'video' | 'review' | 'upload';
const ROUTES: Array<{ id: Route; icon: string }> = [
  { id: 'pipeline', icon: '◫' },
  { id: 'setup', icon: '⚙' },
  { id: 'screens', icon: '▭' },
  { id: 'metadata', icon: '¶' },
  { id: 'design', icon: '✦' },
  { id: 'video', icon: '▶' },
  { id: 'review', icon: '☑' },
  { id: 'upload', icon: '↑' },
];

function useRoute(): [Route, (r: Route) => void] {
  const read = (): Route => {
    const h = location.hash.replace(/^#\/?/, '') as Route;
    return ROUTES.some((r) => r.id === h) ? h : 'pipeline';
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => (location.hash = `/${r}`)];
}

export function App() {
  const { state, run, dismiss } = useStudio();
  const [route, go] = useRoute();
  const [claudeOpen, setClaudeOpen] = useState(false);
  const busy = useBusy();
  const o = state.overview;

  useEffect(() => {
    document.title = o?.app?.name ? `${o.app.name} · Vitrin Studio` : 'Vitrin Studio';
  }, [o?.app?.name]);

  const badges: Partial<Record<Route, { n: number; tone?: 'warn' }>> = {};
  // Everything waiting for the user: blockers, decisions and the approve/upload clicks.
  const pending = o ? pendingDecisions(o).length : 0;
  if (pending) badges.pipeline = { n: pending, tone: 'warn' };
  if (o?.validation && !o.validation.ok) badges.review = { n: o.validation.counts.error, tone: 'warn' };

  return (
    <div className="shell" style={claudeOpen ? undefined : ({ '--drawer': '0px' } as React.CSSProperties)}>
      <div className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          Vitrin Studio
        </div>
        {o?.app && (
          <div className="app">
            {o.app.icon && <img src={fileUrl(o.app.icon)} alt="" />}
            <span>{o.app.name}</span>
            {o.app.bundleId && <span className="dim mono">{o.app.bundleId}</span>}
          </div>
        )}
        <div className="spacer" />
        {state.job && (
          <span className="pill accent">
            <span className="dot busy" /> vitrin {state.job.command}
          </span>
        )}
        {state.claudeRunning && (
          <span className="pill accent">
            <span className="dot busy" /> {t('claudeBusy')}
          </span>
        )}
        <span className="pill" title={state.connected ? t('connected') : t('disconnected')}>
          <span className={`dot ${state.connected ? 'on' : ''}`} /> {state.connected ? t('connected') : t('disconnected')}
        </span>
        <Button size="sm" kind={claudeOpen ? 'primary' : undefined} onClick={() => setClaudeOpen((v) => !v)}>
          ✳ {t('claude')}
        </Button>
      </div>

      <nav className="sidebar">
        {ROUTES.map((r) => (
          <button key={r.id} className={`nav ${route === r.id ? 'active' : ''}`} onClick={() => go(r.id)}>
            <span className="ico">{r.icon}</span>
            {t(r.id)}
            {badges[r.id] && <span className={`badge ${badges[r.id]!.tone ?? ''}`}>{badges[r.id]!.n}</span>}
          </button>
        ))}
        <div className="foot">
          Vitrin {o?.version ?? __VITRIN_VERSION__}
          <br />
          <span className="mono" title={o?.root}>
            {o?.root.split('/').slice(-2).join('/')}
          </span>
        </div>
      </nav>

      <main className="main">
        {state.loadError && !o ? (
          <Empty>{state.loadError}</Empty>
        ) : !o ? (
          <Empty>{t('loading')}</Empty>
        ) : !o.initialized ? (
          <div className="page">
            <header>
              <h2>{t('notInitialized')}</h2>
              <p>{t('initHint')}</p>
            </header>
            <div className="row">
              <Button kind="primary" disabled={busy} onClick={() => run('init', { language: navigator.language.startsWith('tr') ? 'tr' : undefined })}>
                {t('initNow')}
              </Button>
              <code className="dim">{o.root}</code>
            </div>
          </div>
        ) : o.configError ? (
          <Empty>
            <b>vitrin.config.yaml</b>: {o.configError}
          </Empty>
        ) : (
          <Page route={route} openClaude={() => setClaudeOpen(true)} />
        )}
      </main>

      <aside className={`drawer ${claudeOpen ? '' : 'hidden'}`}>{claudeOpen && <ClaudePanel onClose={() => setClaudeOpen(false)} />}</aside>

      <Console />

      <div className="toasts">
        {state.toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => dismiss(toast.id)}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Page({ route, openClaude }: { route: Route; openClaude: () => void }) {
  switch (route) {
    case 'setup':
      return <Setup />;
    case 'screens':
      return <Screens openClaude={openClaude} />;
    case 'metadata':
      return <Metadata openClaude={openClaude} />;
    case 'design':
      return <Design openClaude={openClaude} />;
    case 'video':
      return <Video openClaude={openClaude} />;
    case 'review':
      return <Review />;
    case 'upload':
      return <Upload />;
    default:
      return <Pipeline openClaude={openClaude} />;
  }
}
