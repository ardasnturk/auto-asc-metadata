import type { Blocker, Overview, PipelineStage, StageStatus, StageView } from './api';
import { t, type UiKey } from './i18n';
import { useBusy, useStudio } from './store';
import { Button, Pill } from './ui';

/** How the server's stage model (overview.flow, blockers, next) reads in the Studio: labels, tones and fixes. */

export const STAGE_TITLE: Record<PipelineStage | 'upload', UiKey> = {
  analyze: 'stageAnalyze',
  research: 'stageResearch',
  write: 'stageWrite',
  capture: 'stageCapture',
  mockups: 'stageMockups',
  design: 'stageDesign',
  video: 'stageVideo',
  validate: 'stageValidate',
  review: 'stageReview',
  rank: 'stageRank',
  upload: 'upload',
};

const STATUS: Record<StageStatus, { key: UiKey; tone?: 'ok' | 'warn' | 'err' | 'info' }> = {
  done: { key: 'statusDone', tone: 'ok' },
  'needs-claude': { key: 'statusNeedsClaude', tone: 'warn' },
  'needs-user': { key: 'statusNeedsUser', tone: 'warn' },
  blocked: { key: 'statusBlocked', tone: 'err' },
  outdated: { key: 'statusOutdated', tone: 'info' },
  'not-run': { key: 'statusNotRun' },
  skipped: { key: 'statusSkipped' },
};

export function StatusPill({ status }: { status: StageStatus }) {
  return <Pill tone={STATUS[status].tone}>{t(STATUS[status].key)}</Pill>;
}

/** The CSS class of a stage row (its number circle takes the status color). */
export const statusClass = (status: StageStatus): string => ({ done: 'ok', 'needs-claude': 'needs-input', 'needs-user': 'needs-input', blocked: 'blocked', outdated: 'warning', 'not-run': '', skipped: 'skipped' })[status];

/** Why a stage has its status, in words; empty when the status says it all. */
export function stageReason(view: StageView, o: Overview): string {
  if (!view.reason) return '';
  if (view.status === 'outdated') return t('outdatedBy', { stage: t(STAGE_TITLE[view.reason as PipelineStage] ?? 'stage') });
  if (view.reason === 'validation-errors') return t('reasonValidation', { n: o.validation?.counts.error ?? 0 });
  if (view.reason === 'content-changed') return t('reasonContentChanged');
  if (view.reason === 'rejected') return t('reasonRejected');
  const blocker = o.blockers.find((b) => b.code === view.reason);
  return blocker ? blockerText(blocker) : '';
}

const BLOCKER_TEXT: Record<Blocker['code'], UiKey> = {
  'config-error': 'blockerConfigError',
  'stray-locales': 'blockerStrayLocales',
  'primary-locale': 'blockerPrimaryLocale',
  'ffmpeg-missing': 'blockerFfmpegMissing',
  'claude-missing': 'blockerClaudeMissing',
  'uploader-unset': 'blockerUploaderUnset',
  'uploader-missing': 'blockerUploaderMissing',
  'keys-missing': 'blockerKeysMissing',
};

const joined = (params: Blocker['params']): Record<string, string | number> => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));

export function blockerText(b: Blocker): string {
  return t(BLOCKER_TEXT[b.code], joined(b.params));
}

function fixLabel(fix: Blocker['fixes'][number], b: Blocker): string {
  switch (fix.id) {
    case 'add-locales':
      return t('fixAddLocales', { n: (b.params.locales as string[]).length });
    case 'drop-locales':
      return t('fixDropLocales');
    case 'set-primary':
      return t('fixSetPrimary', { locale: String(fix.args.primaryLocale) });
    case 'add-primary':
      return t('fixAddPrimary', { locale: String(b.params.primary) });
    case 'use-asc':
      return t('fixUseAsc');
    case 'use-deliver':
      return t('fixUseDeliver');
    default:
      return fix.id;
  }
}

/** One blocker: what is wrong, and its one-click fixes (or the install command to copy). */
export function BlockerItem({ blocker, primary }: { blocker: Blocker; primary?: boolean }) {
  const { run, toast } = useStudio();
  const busy = useBusy();
  const install = typeof blocker.params.install === 'string' ? blocker.params.install : undefined;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(install!);
      toast(t('copied'), 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };
  return (
    <div className={`blocker ${blocker.severity}`}>
      <div>{blockerText(blocker)}</div>
      {(blocker.fixes.length > 0 || install) && (
        <div className="row wrap">
          {blocker.fixes.map((f, i) => (
            <Button key={f.id} size="sm" kind={primary && i === 0 ? 'primary' : undefined} disabled={busy} onClick={() => run(f.command, f.args)}>
              {fixLabel(f, blocker)}
            </Button>
          ))}
          {install && (
            <>
              <code>{install}</code>
              <Button size="sm" kind="ghost" onClick={copy}>
                {t('copy')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
