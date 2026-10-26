#!/usr/bin/env node
import { log, mask, SchemaError, setLogMode } from '@vitrin/core';
import { Command } from 'commander';
import pc from 'picocolors';
import { approvalStage, approveCommand } from './approval.js';
import { createContext, EXIT, NeedsInput, type GlobalOptions } from './context.js';
import { runDoctor } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { analyzeCommand, captureCommand, designCommand, researchCommand, validateCommand, videoCommand, writeCommand } from './commands/pipeline.js';
import { platformsCommand, selectCommand } from './commands/select.js';
import { submitCommand, uploadCommand } from './commands/upload.js';
import { finalizeCommand } from './finalize.js';
import { reviewCommand } from './review-server.js';

const program = new Command();
program
  .name('vitrin')
  .description('iOS App Store Connect metadata, screenshot, creative and App Preview automation')
  .version('0.3.0')
  .option('-C, --cwd <dir>', 'app repository (default: current directory)')
  .option('-f, --force', 're-run the stage even if its inputs are unchanged')
  .option('--json', 'machine-readable output')
  .option('-q, --quiet', 'warnings and errors only');

function globals(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

/** Uniform error handling: NeedsInput → exit 2, everything else → exit 1, secrets always masked. */
function action<A extends unknown[]>(fn: (...args: A) => Promise<number>) {
  return async (...args: A) => {
    setLogMode(globals());
    let code: number;
    try {
      code = await fn(...args);
    } catch (err) {
      if (err instanceof NeedsInput) {
        log.warn(err.message);
        for (const d of err.details) log.info(`  ${d}`);
        code = EXIT.NEEDS_INPUT;
      } else if (err instanceof SchemaError) {
        log.error(err.message);
        code = EXIT.FAIL;
      } else {
        log.error(mask((err as Error).message ?? String(err)));
        if (process.env.VITRIN_DEBUG) console.error(err);
        code = EXIT.FAIL;
      }
    }
    process.exitCode = code;
  };
}

program
  .command('init')
  .description('creates vitrin.config.yaml, .env.example, .gitignore and the fastlane templates')
  .action(action(async () => initCommand({ cwd: globals().cwd, force: globals().force })));

program
  .command('doctor')
  .description('checks tools, keys, ASC access, the app version, URLs and refData')
  .option('--create-version <version>', 'if there is no editable version, try to create one with deliver')
  .option('--offline', 'make no network requests')
  .option('--play-live', 'read-only Google Play API test (opens and deletes an edit)')
  .action(
    action(async (o: { createVersion?: string; offline?: boolean; playLive?: boolean }) => {
      const ctx = await createContext(globals());
      const res = await runDoctor(ctx, o);
      log.result(res);
      return res.exitCode;
    }),
  );

program.command('analyze').description('reads the Xcode project → .vitrin/app_profile.json').action(action(async () => analyzeCommand(await createContext(globals()))));

program
  .command('research')
  .description('competitor and keyword research → competitors.json, keywords/<locale>.json')
  .option('--no-images', 'do not download competitor screenshots (no OCR/palette)')
  .action(action(async (o: { images: boolean }) => researchCommand(await createContext(globals()), { skipImages: !o.images })));

program.command('write').description('validates the metadata Claude wrote and exports it to fastlane/metadata').action(action(async () => writeCommand(await createContext(globals()))));

program
  .command('platforms')
  .description('lists detected platforms with evidence and the targets each would produce')
  .option('--json', 'machine-readable output for the platform multi-select')
  .action(action(async (o: { json?: boolean }) => platformsCommand(await createContext(globals()), { json: o.json || globals().json })));

program
  .command('select')
  .description('stores the platforms and asset kinds to produce in vitrin.config.yaml (selection)')
  .option('--platforms <platforms>', 'ios,macos,watchos,tvos,visionos,android or "all"')
  .option('--assets <assets>', 'metadata,screenshots,previews,creatives,events or "all"')
  .action(action(async (o: { platforms?: string; assets?: string }) => selectCommand(await createContext(globals()), { platforms: o.platforms, assets: o.assets })));

program
  .command('capture')
  .description('raw screenshots and recordings (simulators, Mac window, Android emulator) → .vitrin/raw')
  .option('--family <families>', 'iphone,ipad,duo,mac,watch,tv,vision,android-phone,android-tablet')
  .option('--locale <locales>', 'comma-separated locales')
  .action(action(async (o: { family?: string; locale?: string }) => captureCommand(await createContext(globals()), { families: o.family?.split(','), locales: o.locale?.split(',') })));

program
  .command('design')
  .description('renders badged screenshots and creatives from HTML templates')
  .option('--only <ids>', 'only these shot ids (01,02)')
  .option('--samples', 'render the first two shots in several style presets plus a contact sheet (comparison only, nothing uploaded)')
  .option('--count <n>', 'number of sample designs', '4')
  .option('--styles <presets>', 'comma-separated preset ids to sample')
  .action(
    action(async (o: { only?: string; samples?: boolean; count?: string; styles?: string }) =>
      designCommand(await createContext(globals()), { only: o.only?.split(','), samples: o.samples, count: o.count ? Number(o.count) : undefined, styles: o.styles?.split(',') }),
    ),
  );

program
  .command('video')
  .description('App Previews and header/search loops with Remotion')
  .option('--styles <styles>', 'render the first preview in these styles for comparison: classic,showcase,kinetic,energetic | all')
  .option('--locale <locales>', 'locales for --styles (default: primary locale)')
  .action(action(async (o: { styles?: string; locale?: string }) => videoCommand(await createContext(globals()), { styles: o.styles?.split(','), locales: o.locale?.split(',') })));

program
  .command('validate')
  .description('text, image, video and claim-evidence checks → .vitrin/validation.json')
  .action(
    action(async () => {
      const ctx = await createContext(globals());
      const { code, report } = await validateCommand(ctx);
      log.result(report);
      return code;
    }),
  );

program
  .command('review')
  .description('review gallery of everything that would be uploaded → .vitrin/report.html (--serve: approve/reject in the browser)')
  .option('--serve', 'serve the gallery on 127.0.0.1 with approve / reject buttons; waits for the decision')
  .option('--port <port>', 'port for --serve (0 = any free port)', '4870')
  .action(action(async (o: { serve?: boolean; port: string }) => reviewCommand(await createContext(globals()), { serve: o.serve, port: Number(o.port) })));

program
  .command('approve')
  .description('records the user\'s approval of exactly the reviewed content → .vitrin/approval.json (only after an explicit "yes")')
  .option('--expect-hash <hash>', 'overall hash (or its prefix) the user reviewed; refuses if the content differs')
  .option('--reject <items...>', 'reject these review items (id or file path from the report) instead of approving')
  .option('--comment <text>', 'the user\'s comment for --reject')
  .action(
    action(async (o: { expectHash?: string; reject?: string[]; comment?: string }) => {
      return approveCommand(await createContext(globals()), { expectHash: o.expectHash, reject: o.reject, comment: o.comment });
    }),
  );

program
  .command('upload')
  .description('uploads with fastlane + the ASC API (plan first; --dry-run shows the plan only)')
  .option('--dry-run', 'show the plan only')
  .option('--yes', 'skip the terminal prompt (only if the user explicitly said yes); never skips the approval gate')
  .option('--uploader <name>', 'deliver | asset-library')
  .option('--creatives', 'also upload the product page header and search creatives')
  .option('--cpp', 'create the Custom Product Page suggestions')
  .option('--events', 'create the In-App Event drafts')
  .option('--skip-screenshots', 'skip screenshots and videos')
  .action(action(async (o) => uploadCommand(await createContext(globals()), o)));

program
  .command('finalize')
  .description('after a checked upload: keep the uploaded set in metadata/ (--keep) or delete the generated files (--discard)')
  .option('--keep', 'copy exactly the uploaded files to metadata/, then delete the working copies')
  .option('--discard', 'delete the generated media; keep the source JSON')
  .option('--checked', 'the user checked the read-back / store listing after the upload')
  .action(
    action(async (o: { keep?: boolean; discard?: boolean; checked?: boolean }) => {
      if (o.keep && o.discard) throw new NeedsInput('Choose one: --keep or --discard.');
      return finalizeCommand(await createContext(globals()), { keep: o.keep ? true : o.discard ? false : undefined, checked: o.checked });
    }),
  );

program
  .command('submit')
  .description('submits for review — requires explicit confirmation')
  .option('--confirm <bundleId>', 'type the bundle id to confirm')
  .action(action(async (o: { confirm?: string }) => submitCommand(await createContext(globals()), o)));

program
  .command('all')
  .description('analyze → research → write → capture → design → video → validate → review → (approval) → upload --dry-run')
  .option('--skip-capture', 'use the existing raw captures')
  .option('--no-images', 'research: do not download competitor screenshots')
  .action(
    action(async (o: { skipCapture?: boolean; images: boolean }) => {
      const ctx = await createContext(globals());
      log.step(pc.bold('doctor (early warning)'));
      const early = await runDoctor(ctx, { offline: true });
      if (early.missingKeys.length) log.warn('Keys are missing; generation continues, the upload step will stop at the gate.');
      const steps: Array<[string, () => Promise<number>]> = [
        ['analyze', () => analyzeCommand(ctx)],
        ['research', () => researchCommand(ctx, { skipImages: !o.images })],
        ['write', () => writeCommand(ctx)],
        ['capture', () => (o.skipCapture ? Promise.resolve(EXIT.OK) : captureCommand(ctx))],
        ['design', () => designCommand(ctx)],
        ['video', () => videoCommand(ctx)],
        ['validate', async () => (await validateCommand(ctx)).code],
        ['review', () => reviewCommand(ctx, {})],
        ['approval', () => approvalStage(ctx)],
        ['upload --dry-run', () => uploadCommand(ctx, { dryRun: true })],
      ];
      for (const [name, fn] of steps) {
        log.info('');
        log.step(pc.bold(name));
        const code = await fn();
        if (code !== EXIT.OK) {
          log.warn(`“${name}” ${code === EXIT.NEEDS_INPUT ? 'is waiting for input' : 'failed'}; fix it and continue with \`vitrin all\` (completed stages are skipped).`);
          return code;
        }
      }
      log.ok('All stages done and the content is approved. To upload: `vitrin doctor`, then `vitrin upload --yes` once the user confirms the plan.');
      return EXIT.OK;
    }),
  );

await program.parseAsync(process.argv);
