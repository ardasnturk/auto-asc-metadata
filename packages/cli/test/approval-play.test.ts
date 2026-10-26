import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInventory, checkApproval, recordApproval, syncFastlaneMetadata } from '../src/approval.js';
import { createContext } from '../src/context.js';
import { makeFixture } from './fixture.js';

describe('Google Play export under approval', () => {
  it('exports the Play listing before hashing, so a changed listing invalidates the approval', async () => {
    const fx = await makeFixture({ android: false });
    const profileFile = join(fx.root, '.vitrin', 'app_profile.json');
    const profile = JSON.parse(readFileSync(profileFile, 'utf8'));
    profile.app.platforms = ['ios', 'android'];
    profile.project.androidApplicationId = 'com.example.ritim';
    writeFileSync(profileFile, JSON.stringify(profile));
    const playDir = join(fx.root, '.vitrin', 'metadata', 'play');
    mkdirSync(playDir, { recursive: true });
    const listing = { locale: 'en-US', title: 'Ritim: Habit Tracker', shortDescription: 'Build streaks that stick.', fullDescription: 'Ritim helps you build habits that last.' };
    writeFileSync(join(playDir, 'en-US.json'), JSON.stringify(listing));
    writeFileSync(join(playDir, 'app.json'), JSON.stringify({ track: 'production' }));
    const ctx = await createContext({ cwd: fx.root });

    expect(await syncFastlaneMetadata(ctx)).toBe(true);
    const title = join(fx.root, 'fastlane', 'metadata', 'android', 'en-US', 'title.txt');
    expect(readFileSync(title, 'utf8')).toBe('Ritim: Habit Tracker\n');
    const inv = await buildInventory(ctx);
    expect(inv.files.map((f) => f.path)).toContain('fastlane/metadata/android/en-US/title.txt');

    await recordApproval(ctx, inv, 'cli');
    expect((await checkApproval(ctx)).ok).toBe(true);

    writeFileSync(join(playDir, 'en-US.json'), JSON.stringify({ ...listing, title: 'Ritim: Daily Habits' }));
    await syncFastlaneMetadata(ctx);
    const res = await checkApproval(ctx);
    expect(res.ok).toBe(false);
    expect(res.changed).toContain('fastlane/metadata/android/en-US/title.txt');
  });
});
