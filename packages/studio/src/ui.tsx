import { useEffect, useState, type ReactNode } from 'react';
import { fileUrl } from './api';
import { t } from './i18n';
import type { FileState } from './store';

/** Small building blocks shared by the pages. */

export function Button({ kind, size, children, ...rest }: { kind?: 'primary' | 'danger' | 'ghost'; size?: 'sm' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={['btn', kind ?? '', size ?? '', rest.className ?? ''].join(' ').trim()}>
      {children}
    </button>
  );
}

export function Pill({ tone, children }: { tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'; children: ReactNode }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header>
          <h3>{title}</h3>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={tab.id === value} className={tab.id === value ? 'active' : ''} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={`check ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Field({ label, hint, right, children }: { label: ReactNode; hint?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        {label}
        {right}
      </label>
      {children}
      {hint && <div className="dim small">{hint}</div>}
    </div>
  );
}

/** Grapheme count (what App Store Connect counts for most fields). */
export function graphemes(s: string): number {
  const seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (!seg) return [...s].length;
  let n = 0;
  for (const _ of new seg('und', { granularity: 'grapheme' }).segment(s)) n++;
  return n;
}
export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

export function Counter({ value, max, unit }: { value: string; max?: number; unit?: 'chars' | 'bytes' }) {
  const used = unit === 'bytes' ? utf8Bytes(value) : graphemes(value);
  if (!max) return <span className="count">{used} {unit === 'bytes' ? t('bytes') : t('chars')}</span>;
  const pct = Math.min(100, Math.round((used / max) * 100));
  const cls = used > max ? 'over' : pct > 90 ? 'warn' : '';
  return (
    <span className={`count ${cls}`}>
      {used} / {max} {unit === 'bytes' ? t('bytes') : t('chars')}
    </span>
  );
}

export function Meter({ value, max, unit }: { value: string; max: number; unit?: 'chars' | 'bytes' }) {
  const used = unit === 'bytes' ? utf8Bytes(value) : graphemes(value);
  const pct = Math.min(100, Math.round((used / max) * 100));
  return (
    <div className="meter">
      <i className={used > max ? 'over' : pct > 90 ? 'warn' : ''} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TextField({ label, value, onChange, max, unit, multiline, rows, hint, placeholder, mono }: { label: ReactNode; value: string; onChange: (v: string) => void; max?: number; unit?: 'chars' | 'bytes'; multiline?: boolean; rows?: number; hint?: ReactNode; placeholder?: string; mono?: boolean }) {
  return (
    <Field label={label} hint={hint} right={<Counter value={value} max={max} unit={unit} />}>
      {multiline ? <textarea className={`input ${mono ? 'code' : ''}`} rows={rows ?? 4} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      {max ? <Meter value={value} max={max} unit={unit} /> : null}
    </Field>
  );
}

export function Select({ value, onChange, options, allowEmpty }: { value: string | undefined; onChange: (v: string) => void; options: Array<{ value: string; label: string }> | string[]; allowEmpty?: string }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Comma-separated list in one input (ids, colors, feature ids). */
export function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => setText(value.join(', ')), [value.join('\u0000')]);
  return <input className="input" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split(',').map((s) => s.trim()).filter(Boolean))} />;
}

export function Lightbox({ src, video, onClose }: { src: string; video?: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      {video ? <video src={src} controls autoPlay onClick={(e) => e.stopPropagation()} /> : <img src={src} alt="" />}
    </div>
  );
}

export function Thumb({ path, caption, bust, wide, large, video }: { path: string; caption?: string; bust?: string | number; wide?: boolean; large?: boolean; video?: boolean }) {
  const [open, setOpen] = useState(false);
  const src = fileUrl(path, bust);
  return (
    <>
      <div className={`thumb ${wide ? 'wide' : ''} ${large ? 'lg' : ''}`} onClick={() => setOpen(true)} title={path}>
        {video ? <video src={src} muted preload="metadata" /> : <img src={src} alt={caption ?? path} loading="lazy" />}
        <div className="cap">{caption ?? path.split('/').pop()}</div>
      </div>
      {open && <Lightbox src={src} video={video} onClose={() => setOpen(false)} />}
    </>
  );
}

export function Modal({ title, onClose, children, wide, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="row" style={{ marginBottom: 12 }}>
          <h3 className="grow">{title}</h3>
          {actions}
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t('close')}
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Save / status bar for an editable file, with the schema issues the server returned. */
export function SaveBar<T>({ file, extra }: { file: FileState<T>; extra?: ReactNode }) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="stack">
      <div className="row wrap">
        <Button
          kind="primary"
          disabled={!file.dirty || saving || file.readOnly}
          onClick={async () => {
            setSaving(true);
            await file.save();
            setSaving(false);
          }}
        >
          {saving ? t('saving') : t('save')}
        </Button>
        {file.dirty && <span className="dim small">unsaved</span>}
        {file.readOnly && <Pill>read-only</Pill>}
        {extra}
      </div>
      {file.error && <div className="small" style={{ color: 'var(--err)' }}>{file.error}</div>}
      {file.issues.length > 0 && (
        <ul className="issues">
          {file.issues.map((i, n) => (
            <li key={n} className="error">
              {i}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Raw editor for any file: JSON (pretty-printed on save by the server) or text. */
export function CodeEditor<T>({ file, rows }: { file: FileState<T>; rows?: number }) {
  return (
    <div className="stack">
      <textarea className="input code" rows={rows ?? 24} value={file.text} readOnly={file.readOnly} spellCheck={false} onChange={(e) => file.setText(e.target.value)} />
      <SaveBar file={file} />
    </div>
  );
}

/** A form/JSON toggle for an editor page section. */
export function useMode(): ['form' | 'json', ReactNode] {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const toggle = (
    <div className="row" style={{ gap: 2 }}>
      <Button size="sm" kind={mode === 'form' ? undefined : 'ghost'} onClick={() => setMode('form')}>
        {t('form')}
      </Button>
      <Button size="sm" kind={mode === 'json' ? undefined : 'ghost'} onClick={() => setMode('json')}>
        {t('json')}
      </Button>
    </div>
  );
  return [mode, toggle];
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtBytes(n: number): string {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
