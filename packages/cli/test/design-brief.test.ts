import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { designBrief, videoBrief } from '../src/briefs.js';
import { createContext } from '../src/context.js';
import { makeFixture } from './fixture.js';
import { profileWith } from './helpers.js';

describe('design brief', () => {
  it('asks for samples first, then the user’s pick, then the full shot list', async () => {
    const fx = await makeFixture();
    const ctx = await createContext({ cwd: fx.root });
    const profile = profileWith({ displayName: 'Ritim' });
    const body = readFileSync(await designBrief(ctx, { ...profile, brand: { ...profile.brand, accentColor: '#5B4BE8', colors: [] }, categorySuggestion: { primary: 'HEALTH_AND_FITNESS', reason: '' } }), 'utf8');
    const samples = body.indexOf('vitrin design --samples');
    const ask = body.indexOf('A, B, C or D');
    const full = body.indexOf('the full shot list');
    expect(samples).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(samples);
    expect(full).toBeGreaterThan(ask);
    expect(body).toContain('"preset": "liquid-glass-aurora"');
    expect(body).toContain('#5B4BE8');
    expect(body).toContain('neon-athletic-night'); // category suggestion
    expect(body).toContain('"framing": "auto"');
    expect(body).toContain('styles/');
  });

  it('mentions landscape previews and the shared frames', async () => {
    const fx = await makeFixture();
    const ctx = await createContext({ cwd: fx.root });
    const body = readFileSync(await videoBrief(ctx), 'utf8');
    expect(body).toContain('1920×1080');
    expect(body).toContain('same device frames');
  });
});
