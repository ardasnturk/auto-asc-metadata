import { CppSuggestions, ExperimentPlan, ShotList } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { screenshotTreatments, shotListFor } from '../src/commands/pipeline.js';

const shot = (id: string, slug: string, extra: Record<string, unknown> = {}) => ({ id, slug, archetype: 'hero', screens: ['home'], featureIds: ['a'], copy: { 'en-US': { headline: `Default ${id}` } }, ...extra });

describe('Custom Product Page sets', () => {
  const shots = ShotList.parse({ shots: [shot('01', 'hero', { bridge: true }), shot('02', 'streaks'), shot('03', 'water'), shot('04', 'reminders')] });

  it('takes the page’s shots in its order, renumbered, with its own copy', () => {
    const [page] = CppSuggestions.parse({ pages: [{ id: 'water', name: 'Water', segment: 'hydration', rationale: '', shots: ['03', '01', '04'], copy: { '03': { 'en-US': { headline: 'Drink *more* water' } } } }] }).pages;
    const list = shotListFor(shots, page!);
    expect(list.shots.map((s) => [s.id, s.slug])).toEqual([['01', 'water'], ['02', 'hero'], ['03', 'reminders']]);
    expect(list.shots[0]!.copy['en-US']!.headline).toBe('Drink *more* water');
    expect(list.shots[1]!.copy['en-US']!.headline).toBe('Default 01');
    // The hero's bridge was made for shot 02, which does not follow it on this page.
    expect(list.shots[1]!.bridge).toBe(false);
  });

  it('keeps a bridge when its partner still follows it', () => {
    const [page] = CppSuggestions.parse({ pages: [{ id: 'core', name: 'Core', segment: '', rationale: '', shots: ['01', '02'] }] }).pages;
    expect(shotListFor(shots, page!).shots[0]!.bridge).toBe(true);
  });
});

describe('Product Page Optimization treatments', () => {
  const shots = ShotList.parse({ shots: [shot('01', 'hero'), shot('02', 'streaks'), shot('03', 'water')] });
  const plan = ExperimentPlan.parse({
    experiments: [
      {
        id: 'hero',
        name: 'Hero',
        hypothesis: 'If the hero states the outcome, conversion rises because people search for outcomes.',
        treatments: [
          { id: 'outcome', name: 'Outcome', change: 'hero copy', copy: { '01': { 'en-US': { headline: 'Never miss *a day*' } } } },
          { id: 'icon', name: 'Icon', change: 'orange icon', appIconName: 'Orange' },
        ],
      },
      { id: 'done', name: 'Done', hypothesis: 'x', treatments: [{ id: 'a', name: 'A', change: 'order', shots: ['02', '01'] }], result: { endedAt: '2026-10-01', winner: 'a' } },
    ],
  });

  it('renders only open tests’ treatments that change the screenshots', () => {
    expect(screenshotTreatments(plan).map((x) => `${x.experiment.id}/${x.treatment.id}`)).toEqual(['hero/outcome']);
  });

  it('keeps the original order when a treatment only changes copy', () => {
    const list = shotListFor(shots, plan.experiments[0]!.treatments[0]!);
    expect(list.shots.map((s) => s.slug)).toEqual(['hero', 'streaks', 'water']);
    expect(list.shots[0]!.copy['en-US']!.headline).toBe('Never miss *a day*');
  });
});
