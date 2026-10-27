import { existsSync, parseWith } from '@vitrin/core';
import { AppMetadata, AppProfile, ArtDirection, CppSuggestions, ExperimentPlan, KeywordPlan, LocaleMetadata, PlayAppMetadata, PlayListing, ShotList, VideoPlan, VitrinConfig } from '@vitrin/schemas';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ZodType } from 'zod';

/**
 * The files the Studio's editors read and write: the JSON Claude writes (validated against its schema on save), the
 * HTML screens and bespoke layouts, the strings files, the config, and read-only views of what the CLI produced.
 * Everything else under the app root is off limits to the editor API (media goes through the static route).
 */

export type EditableKind = 'json' | 'text' | 'yaml' | 'markdown';

export interface EditableFile {
  /** Posix path relative to the app root. */
  rel: string;
  abs: string;
  kind: EditableKind;
  schema?: ZodType;
  readOnly: boolean;
  exists: boolean;
}

const toPosix = (p: string) => p.split(sep).join('/');
const LOCALE = '[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*';

interface Rule {
  re: RegExp;
  kind: EditableKind;
  schema?: ZodType;
  readOnly?: boolean;
}

const RULES: Rule[] = [
  { re: /^vitrin\.config\.yaml$/, kind: 'yaml', schema: VitrinConfig },
  { re: /^metadata\/listing\/app\.json$/, kind: 'json', schema: AppMetadata },
  { re: /^metadata\/listing\/play\/app\.json$/, kind: 'json', schema: PlayAppMetadata },
  { re: new RegExp(`^metadata/listing/play/${LOCALE}\\.json$`), kind: 'json', schema: PlayListing },
  { re: new RegExp(`^metadata/listing/${LOCALE}\\.json$`), kind: 'json', schema: LocaleMetadata },
  { re: /^metadata\/art-direction\.json$/, kind: 'json', schema: ArtDirection },
  { re: /^metadata\/shots\.json$/, kind: 'json', schema: ShotList },
  { re: /^metadata\/video-plan\.json$/, kind: 'json', schema: VideoPlan },
  { re: /^metadata\/app_profile\.json$/, kind: 'json', schema: AppProfile },
  { re: /^metadata\/experiments\.json$/, kind: 'json', schema: ExperimentPlan },
  { re: /^metadata\/cpp-suggestions\.json$/, kind: 'json', schema: CppSuggestions },
  { re: new RegExp(`^metadata/research/keywords/${LOCALE}\\.json$`), kind: 'json', schema: KeywordPlan },
  { re: new RegExp(`^metadata/screens/strings/${LOCALE}\\.json$`), kind: 'json' },
  { re: /^metadata\/(screens|designs)\/[\w./-]+\.(html|css|js|svg)$/, kind: 'text' },
  { re: /^metadata\/i18n\/[\w-]+\.json$/, kind: 'json' },
  { re: /^metadata\/briefs\/[\w-]+\.md$/, kind: 'markdown', readOnly: true },
  { re: /^metadata\/(validation|state|render-manifest|upload-plan|approval|review-feedback|uploaded)\.json$/, kind: 'json', readOnly: true },
  { re: /^metadata\/design-samples\/samples\.json$/, kind: 'json', readOnly: true },
  { re: /^metadata\/mockups\/mockups\.json$/, kind: 'json', readOnly: true },
  { re: /^metadata\/research\/(competitors|live-listing)\.json$/, kind: 'json', readOnly: true },
  { re: /^metadata\/rankings\/[\w-]+\.json$/, kind: 'json', readOnly: true },
];

/** Resolves a request path to an editable file, or undefined when it is outside the allowed set. */
export function resolveEditable(root: string, requested: string): EditableFile | undefined {
  if (!requested || requested.includes('\0') || requested.includes('\\') || isAbsolute(requested)) return undefined;
  const rel = toPosix(normalize(requested)).replace(/^\/+/, '');
  if (rel.split('/').some((s) => s === '..' || s === '.env' || s.startsWith('.env.') || s.endsWith('.p8') || s === 'secrets')) return undefined;
  const rule = RULES.find((r) => r.re.test(rel));
  if (!rule) return undefined;
  const abs = resolve(root, rel);
  const inside = relative(root, abs);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return undefined;
  return { rel, abs, kind: rule.kind, schema: rule.schema, readOnly: Boolean(rule.readOnly), exists: existsSync(abs) };
}

export async function readEditable(f: EditableFile): Promise<{ text: string }> {
  return { text: f.exists ? await readFile(f.abs, 'utf8') : '' };
}

export class EditableError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** Validates against the file's schema (JSON or YAML) and writes it; JSON is re-indented, text is written as given. */
export async function writeEditable(f: EditableFile, text: string): Promise<void> {
  if (f.readOnly) throw new EditableError(`${f.rel} is written by Vitrin; edit its source instead.`, [], 403);
  let out = text;
  if (f.kind === 'json' || f.kind === 'yaml') {
    let data: unknown;
    try {
      data = f.kind === 'json' ? JSON.parse(text) : parseYaml(text);
    } catch (err) {
      throw new EditableError(`${f.rel}: ${f.kind === 'json' ? 'invalid JSON' : 'invalid YAML'} — ${(err as Error).message}`);
    }
    if (f.schema) {
      try {
        parseWith(f.rel, data, f.schema);
      } catch (err) {
        const msg = (err as Error).message;
        throw new EditableError(`${f.rel} does not match its schema.`, msg.split('\n').slice(1).filter(Boolean));
      }
    }
    if (f.kind === 'json') out = `${JSON.stringify(data, null, 2)}\n`;
  }
  await writeFile(f.abs, out, 'utf8');
}

/** The listing files of the run, for the Metadata editor: `metadata/listing/<locale>.json` for each store locale. */
export function listingFiles(root: string, locales: string[]): string[] {
  return locales.map((l) => toPosix(join('metadata', 'listing', `${l}.json`)));
}
