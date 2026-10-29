import { useState } from 'react';
import { api, fileUrl, type Blocker, type Overview, type PipelineStage, type StageStatus, type StageView, type StudioQuestion } from './api';
import { t, type UiKey } from './i18n';
import { useBusy, useStudio } from './store';
import { Button, Pill } from './ui';

/** How the server's stage model (overview.flow, blockers, next) reads in the Studio: labels, tones and fixes. */

export const STAGE_TITLE: Record<PipelineStage, UiKey> = {
  analyze: 'stageAnalyze',
  research: 'stageResearch',
  write: 'stageWrite',
  capture: 'stageCapture',
  mockups: 'stageMockups',
  design: 'stageDesign',
  video: 'stageVideo',
  validate: 'stageValidate',
  review: 'stageReview',
  upload: 'stageUpload',
  rank: 'stageRank',
};

/** One line on what a stage does, in the user's terms. */
export const STAGE_HINT: Record<PipelineStage, UiKey> = {
  analyze: 'hintAnalyze',
  research: 'hintResearch',
  write: 'hintWrite',
  capture: 'hintCapture',
  mockups: 'hintMockups',
  design: 'hintDesign',
  video: 'hintVideo',
  validate: 'hintValidate',
  review: 'hintReview',
  upload: 'hintUpload',
  rank: 'hintRank',
};

/** The Studio page where a stage's input and output live. */
export const STAGE_PAGE: Record<PipelineStage, string> = {
  analyze: 'setup',
  research: 'metadata',
  write: 'metadata',
  capture: 'screens',
  mockups: 'screens',
  design: 'design',
  video: 'video',
  validate: 'review',
  review: 'review',
  upload: 'upload',
  rank: 'metadata',
};

export const go = (route: string) => (location.hash = `/${route}`);

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
  if (view.reason === 'readback-differences') return t('reasonReadback');
  if (view.reason === 'question') return t('reasonQuestion');
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
  'design-choice': 'blockerDesignChoice',
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

/** A command or snippet the user runs or pastes themselves, with a copy button. */
export function CopyCode({ text, block }: { text: string; block?: boolean }) {
  const { toast } = useStudio();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('copied'), 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };
  return (
    <span className={`copy-code ${block ? 'block' : ''}`}>
      {block ? <pre>{text}</pre> : <code>{text}</code>}
      <Button size="sm" kind="ghost" onClick={copy}>
        {t('copy')}
      </Button>
    </span>
  );
}

/** What waits for the user: blockers and decisions first, then stages that wait for their click (approve, upload). */
export type Pending = { key: string; question: StudioQuestion } | { key: string; blocker: Blocker } | { key: string; stage: StageView };

const SEVERITY_ORDER: Record<Blocker['severity'], number> = { decision: 0, error: 1, warning: 2 };

export function pendingDecisions(o: Overview): Pending[] {
  const blockers = [...o.blockers].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).map((b): Pending => ({ key: b.code, blocker: b }));
  const stages = o.flow.filter((s) => s.status === 'needs-user' && s.reason !== 'question' && !o.blockers.some((b) => b.code === s.reason)).map((s): Pending => ({ key: `stage-${s.id}`, stage: s }));
  const questions = o.questions.map((q): Pending => ({ key: `question-${q.id}`, question: q }));
  return [...questions, ...blockers, ...stages];
}

/** A stage that waits for the user's click: approving the review, or the upload. */
export function StageDecision({ stage, o }: { stage: StageView; o: Overview }) {
  const upload = stage.id === 'upload';
  return (
    <div className="blocker decision">
      <div>{stage.reason ? stageReason(stage, o) : t(upload ? 'decisionUpload' : 'decisionApprove')}</div>
      <div className="row">
        <Button size="sm" kind="primary" onClick={() => go(STAGE_PAGE[stage.id])}>
          {t(upload ? 'openUpload' : 'openReview')}
        </Button>
      </div>
    </div>
  );
}

/** One blocker: what is wrong, and its one-click fixes (or the install command to copy). */
export function BlockerItem({ blocker, primary, openClaude }: { blocker: Blocker; primary?: boolean; openClaude?: () => void }) {
  const { state, run } = useStudio();
  const busy = useBusy();
  const o = state.overview!;
  if (blocker.code === 'design-choice') return <DesignChoice blocker={blocker} o={o} openClaude={openClaude} />;
  const install = typeof blocker.params.install === 'string' ? blocker.params.install : undefined;
  return (
    <div className={`blocker ${blocker.severity}`}>
      <div>{blockerText(blocker)}</div>
      {blocker.fixes.length === 0 && !install && blocker.stage !== 'upload' && STAGE_PAGE[blocker.stage] && (
        <div className="row">
          <Button size="sm" kind="ghost" onClick={() => go(STAGE_PAGE[blocker.stage])}>
            {t('goToPage')}
          </Button>
        </div>
      )}
      {(blocker.fixes.length > 0 || install) && (
        <div className="row wrap">
          {blocker.fixes.map((f, i) => (
            <Button key={f.id} size="sm" kind={primary && i === 0 ? 'primary' : undefined} disabled={busy} onClick={() => run(f.command, f.args)}>
              {fixLabel(f, blocker)}
            </Button>
          ))}
          {install && <CopyCode text={install} />}
        </div>
      )}
    </div>
  );
}

/**
 * The design brief's question, answered with a click: each sample is a button that hands the choice to Claude, which
 * writes art-direction.json and continues the brief (the full shot list, then the render).
 */
function DesignChoice({ blocker, o, openClaude }: { blocker: Blocker; o: Overview; openClaude?: () => void }) {
  const { toast } = useStudio();
  const busy = useBusy();
  const choose = async (option: { letter: string; style: string; name: string }) => {
    try {
      await api.askClaude({ stage: 'design', extra: `The user looked at the design samples in the Studio and chose ${option.letter}: “${option.name}” (${option.style}). That answers Step 2 of the brief: write art-direction.json with this choice (selectionReason: “The user chose ${option.letter}.”) and continue with Step 3.` });
      toast(t('designChoiceSent', { name: `${option.letter} · ${option.name}` }), 'ok');
      openClaude?.();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };
  return (
    <div className="blocker decision">
      <div>{blockerText(blocker)}</div>
      <div className="row wrap">
        {o.samples?.storePreview && (
          <Button size="sm" onClick={() => window.open(fileUrl(o.samples!.storePreview!), '_blank')}>
            {t('openSamples')}
          </Button>
        )}
        {o.samples?.options.map((x) => (
          <Button key={x.style} size="sm" kind="primary" disabled={busy || !o.claude.available} title={o.claude.available ? x.style : t('claudeMissing')} onClick={() => choose(x)}>
            {x.letter} · {x.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A question Claude left: its options as buttons, or an answer in the user's own words. Answering starts Claude again. */
export function QuestionCard({ question, openClaude }: { question: StudioQuestion; openClaude?: () => void }) {
  const { state, toast } = useStudio();
  const busy = useBusy();
  const [text, setText] = useState('');
  const o = state.overview!;
  const answer = async (value: string) => {
    try {
      await api.answerQuestion(question.id, value);
      setText('');
      toast(t('answerSent'), 'ok');
      openClaude?.();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };
  const disabled = busy || !o.claude.available;
  return (
    <div className="blocker decision">
      <div className="dim small">✳ {t('claudeAsks')}</div>
      <div className="question">{question.question}</div>
      {question.options.length > 0 && (
        <div className="row wrap">
          {question.options.map((x) => (
            <Button key={x.value} size="sm" kind="primary" disabled={disabled} onClick={() => answer(x.value)}>
              {x.label}
            </Button>
          ))}
        </div>
      )}
      <div className="row">
        <input
          className="input grow"
          placeholder={question.options.length ? t('answerPlaceholder') : `${t('answer')}…`}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) void answer(text.trim());
          }}
        />
        <Button size="sm" disabled={disabled || !text.trim()} title={o.claude.available ? '' : t('claudeMissing')} onClick={() => answer(text.trim())}>
          {t('answer')}
        </Button>
      </div>
    </div>
  );
}
