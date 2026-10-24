#!/usr/bin/env node
import { log, mask, SchemaError, setLogMode } from '@vitrin/core';
import { Command } from 'commander';
import { relative } from 'node:path';
import pc from 'picocolors';
import { createContext, EXIT, NeedsInput, type GlobalOptions } from './context.js';
import { runDoctor } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { analyzeCommand, captureCommand, designCommand, researchCommand, validateCommand, videoCommand, writeCommand } from './commands/pipeline.js';
import { submitCommand, uploadCommand } from './commands/upload.js';
import { buildReport } from './report.js';

const program = new Command();
program
  .name('vitrin')
  .description('iOS App Store Connect metadata, ekran görüntüsü, kreatif ve App Preview otomasyonu')
  .version('0.3.0')
  .option('-C, --cwd <dir>', 'uygulama reposu (varsayılan: çalışma dizini)')
  .option('-f, --force', 'girdiler değişmemiş olsa da aşamayı yeniden çalıştır')
  .option('--json', 'makine okunur çıktı')
  .option('-q, --quiet', 'yalnız uyarı ve hatalar');

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
  .description('vitrin.config.yaml, .env.example, .gitignore ve fastlane şablonlarını oluşturur')
  .action(action(async () => initCommand({ cwd: globals().cwd, force: globals().force })));

program
  .command('doctor')
  .description('araçları, anahtarları, ASC erişimini, sürümü, URL’leri ve refData’yı kontrol eder')
  .option('--create-version <version>', 'düzenlenebilir sürüm yoksa deliver ile açmayı dene')
  .option('--offline', 'ağ isteği yapma')
  .action(
    action(async (o: { createVersion?: string; offline?: boolean }) => {
      const ctx = await createContext(globals());
      const res = await runDoctor(ctx, o);
      log.result(res);
      return res.exitCode;
    }),
  );

program.command('analyze').description('Xcode projesini okur → .vitrin/app_profile.json').action(action(async () => analyzeCommand(await createContext(globals()))));

program
  .command('research')
  .description('rakip ve anahtar kelime araştırması → competitors.json, keywords/<locale>.json')
  .option('--no-images', 'rakip görsellerini indirme (OCR/palet yok)')
  .action(action(async (o: { images: boolean }) => researchCommand(await createContext(globals()), { skipImages: !o.images })));

program.command('write').description('Claude’un yazdığı metadata’yı doğrular ve fastlane/metadata’ya aktarır').action(action(async () => writeCommand(await createContext(globals()))));

program
  .command('capture')
  .description('simülatörde ham ekran görüntüleri ve kayıtlar → .vitrin/raw')
  .option('--family <families>', 'iphone,ipad,duo')
  .option('--locale <locales>', 'virgülle ayrılmış diller')
  .action(action(async (o: { family?: string; locale?: string }) => captureCommand(await createContext(globals()), { families: o.family?.split(','), locales: o.locale?.split(',') })));

program
  .command('design')
  .description('HTML şablonlarından rozetli ekran görüntüleri ve kreatifler üretir')
  .option('--only <ids>', 'yalnız bu görsel numaraları (01,02)')
  .action(action(async (o: { only?: string }) => designCommand(await createContext(globals()), { only: o.only?.split(',') })));

program
  .command('video')
  .description('Remotion ile App Preview ve başlık/arama döngüleri')
  .option('--styles <styles>', 'ilk önizlemeyi bu stillerde karşılaştırma için render et: classic,showcase,kinetic,energetic | all')
  .option('--locale <locales>', '--styles için diller (varsayılan: birincil dil)')
  .action(action(async (o: { styles?: string; locale?: string }) => videoCommand(await createContext(globals()), { styles: o.styles?.split(','), locales: o.locale?.split(',') })));

program
  .command('validate')
  .description('metin, görsel, video ve iddia-kanıt kontrolleri → .vitrin/validation.json')
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
  .description('önizleme raporu → .vitrin/report.html')
  .action(
    action(async () => {
      const ctx = await createContext(globals());
      const file = await buildReport(ctx);
      log.ok(`Rapor: ${relative(process.cwd(), file) || file}`);
      log.result({ report: file });
      return EXIT.OK;
    }),
  );

program
  .command('upload')
  .description('fastlane + ASC API ile yükler (önce plan; --dry-run yalnız plan)')
  .option('--dry-run', 'yalnız planı göster')
  .option('--yes', 'plan onaylandı (yalnız kullanıcı açıkça onayladıysa)')
  .option('--uploader <name>', 'deliver | asset-library')
  .option('--creatives', 'ürün sayfası başlığı ve arama kreatiflerini de yükle')
  .option('--cpp', 'Custom Product Page önerilerini oluştur')
  .option('--events', 'In-App Event taslaklarını oluştur')
  .option('--skip-screenshots', 'görsel ve videoları atla')
  .action(action(async (o) => uploadCommand(await createContext(globals()), o)));

program
  .command('submit')
  .description('incelemeye gönderir — açık onay ister')
  .option('--confirm <bundleId>', 'onay için bundle id’yi yaz')
  .action(action(async (o: { confirm?: string }) => submitCommand(await createContext(globals()), o)));

program
  .command('all')
  .description('analyze → research → write → capture → design → video → validate → review → upload --dry-run')
  .option('--skip-capture', 'mevcut ham görüntüleri kullan')
  .option('--no-images', 'research: rakip görsellerini indirme')
  .action(
    action(async (o: { skipCapture?: boolean; images: boolean }) => {
      const ctx = await createContext(globals());
      log.step(pc.bold('doctor (erken uyarı)'));
      const early = await runDoctor(ctx, { offline: true });
      if (early.missingKeys.length) log.warn('Anahtarlar eksik; üretim devam ediyor, yükleme kapıda duracak.');
      const steps: Array<[string, () => Promise<number>]> = [
        ['analyze', () => analyzeCommand(ctx)],
        ['research', () => researchCommand(ctx, { skipImages: !o.images })],
        ['write', () => writeCommand(ctx)],
        ['capture', () => (o.skipCapture ? Promise.resolve(EXIT.OK) : captureCommand(ctx))],
        ['design', () => designCommand(ctx)],
        ['video', () => videoCommand(ctx)],
        ['validate', async () => (await validateCommand(ctx)).code],
        ['review', async () => (await buildReport(ctx), EXIT.OK)],
        ['upload --dry-run', () => uploadCommand(ctx, { dryRun: true })],
      ];
      for (const [name, fn] of steps) {
        log.info('');
        log.step(pc.bold(name));
        const code = await fn();
        if (code !== EXIT.OK) {
          log.warn(`“${name}” ${code === EXIT.NEEDS_INPUT ? 'girdi bekliyor' : 'başarısız'}; düzeltip \`vitrin all\` ile devam et (tamamlanan aşamalar atlanır).`);
          return code;
        }
      }
      log.ok('Tüm aşamalar tamam. Yükleme için: `vitrin doctor`, ardından kullanıcı onayıyla `vitrin upload --yes`.');
      return EXIT.OK;
    }),
  );

await program.parseAsync(process.argv);
