import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import { jobName } from './status';
import { useStudio } from './store';
import { Button } from './ui';

/** The CLI's log lines, live, at the bottom of the Studio: folded until a step runs, then open to follow it. */
export function Console() {
  const { state, clearLogs } = useStudio();
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    if (state.job) setCollapsed(false);
  }, [state.job?.id]);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.logs.length, collapsed]);

  return (
    <div className={`console ${collapsed ? 'collapsed' : ''}`} style={collapsed ? ({ '--console': '32px' } as React.CSSProperties) : undefined}>
      <div className="bar">
        <span className={`dot ${state.job ? 'busy' : 'on'}`} />
        <b>{t('console')}</b>
        <span className="dim">{state.job ? `${jobName(state.job)} · ${t('running')}` : t('idle')}</span>
        <Button size="sm" kind="ghost" onClick={clearLogs}>
          ⌫
        </Button>
        <Button size="sm" kind="ghost" onClick={() => setCollapsed((v) => !v)} style={{ marginLeft: 0 }}>
          {collapsed ? '▴' : '▾'}
        </Button>
      </div>
      {!collapsed && (
        <div
          className="lines"
          ref={ref}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {state.logs.length === 0 && <span className="dim">{t('nothingYet')}</span>}
          {state.logs.map((l, i) => (
            <div key={i} className={`line ${l.level}`}>
              {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
