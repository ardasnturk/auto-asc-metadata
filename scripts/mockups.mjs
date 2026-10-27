// Renders the ready-made device mockup templates shipped with the /vitrin skill
// (plugins/vitrin/skills/vitrin/assets/mockups/): transparent PNGs plus mockups.json with the screen rectangles.
// Run after `pnpm build` whenever packages/render/src/frames.ts or mockups.ts change: node scripts/mockups.mjs
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMockupTemplates } from '../packages/render/dist/index.js';

const out = join(fileURLToPath(new URL('..', import.meta.url)), 'plugins', 'vitrin', 'skills', 'vitrin', 'assets', 'mockups');
const list = await renderMockupTemplates(out, { maxSide: 1000 });
for (const m of list) console.log(`${m.id.padEnd(22)} ${m.width}×${m.height}`);
