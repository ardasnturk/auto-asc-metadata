import type { Issue } from '@vitrin/schemas';

export class IssueList {
  readonly items: Issue[] = [];

  error(code: string, message: string, extra: Partial<Issue> = {}): void {
    this.items.push({ severity: 'error', code, message, ...extra });
  }

  warn(code: string, message: string, extra: Partial<Issue> = {}): void {
    this.items.push({ severity: 'warning', code, message, ...extra });
  }

  info(code: string, message: string, extra: Partial<Issue> = {}): void {
    this.items.push({ severity: 'info', code, message, ...extra });
  }

  push(...issues: Issue[]): void {
    this.items.push(...issues);
  }

  get errors(): Issue[] {
    return this.items.filter((i) => i.severity === 'error');
  }
}

/** Case-insensitive whole-word search that works for any script (and for symbols such as `$` or `#1`). */
export function containsTerm(text: string, term: string, locale?: string): boolean {
  const t = term.toLocaleLowerCase(locale).trim();
  if (!t) return false;
  const hay = text.toLocaleLowerCase(locale);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startsWord = /^[\p{L}\p{N}]/u.test(t);
  const endsWord = /[\p{L}\p{N}]$/u.test(t);
  // CJK has no word separators: plain substring match.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(t)) return hay.includes(t);
  // A hyphen before the term makes it part of a compound ("distraction-free"), not a standalone word.
  const re = new RegExp(`${startsWord ? '(?<![\\p{L}\\p{N}-])' : ''}${escaped}${endsWord ? '(?![\\p{L}\\p{N}])' : ''}`, 'u');
  return re.test(hay);
}
