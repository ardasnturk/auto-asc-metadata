/**
 * Minimal parser for Xcode's project.pbxproj (an OpenStep/ASCII property list).
 * Supports dictionaries, arrays, quoted and bare strings, and comments — enough for Xcode projects.
 */
export type PlistValue = string | PlistValue[] | { [key: string]: PlistValue };

export function parseOpenStepPlist(text: string): PlistValue {
  let i = 0;
  const n = text.length;

  function skipWs(): void {
    while (i < n) {
      const c = text[i]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
      } else if (c === '/' && text[i + 1] === '/') {
        const end = text.indexOf('\n', i + 2);
        i = end === -1 ? n : end + 1;
      } else break;
    }
  }

  function parseQuoted(): string {
    const quote = text[i]!;
    i++;
    let out = '';
    while (i < n && text[i] !== quote) {
      if (text[i] === '\\') {
        const next = text[i + 1]!;
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\' };
        out += map[next] ?? next;
        i += 2;
      } else {
        out += text[i];
        i++;
      }
    }
    i++; // closing quote
    return out;
  }

  function parseBare(): string {
    const start = i;
    while (i < n && /[A-Za-z0-9_$+./:\-<>@\\]/.test(text[i]!)) i++;
    if (start === i) throw new Error(`Could not parse pbxproj: position ${i}, character "${text[i]}"`);
    return text.slice(start, i);
  }

  function parseValue(): PlistValue {
    skipWs();
    const c = text[i];
    if (c === '{') {
      i++;
      const obj: Record<string, PlistValue> = {};
      for (;;) {
        skipWs();
        if (text[i] === '}') {
          i++;
          break;
        }
        const key = text[i] === '"' || text[i] === "'" ? parseQuoted() : parseBare();
        skipWs();
        if (text[i] !== '=') throw new Error(`pbxproj: expected "=" at position ${i}`);
        i++;
        obj[key] = parseValue();
        skipWs();
        if (text[i] === ';') i++;
      }
      return obj;
    }
    if (c === '(') {
      i++;
      const arr: PlistValue[] = [];
      for (;;) {
        skipWs();
        if (text[i] === ')') {
          i++;
          break;
        }
        arr.push(parseValue());
        skipWs();
        if (text[i] === ',') i++;
      }
      return arr;
    }
    if (c === '"' || c === "'") return parseQuoted();
    return parseBare();
  }

  // Skip the `// !$*UTF8*$!` header
  skipWs();
  return parseValue();
}

type Dict = { [key: string]: PlistValue };

export interface PbxTarget {
  id: string;
  name: string;
  productType: string;
  productName?: string;
  buildSettings: Record<string, Record<string, string>>;
  /** Directories synchronised with the file system (Xcode 16+ folder references). */
  syncedFolders: string[];
  dependencies: string[];
}

export interface PbxProject {
  developmentRegion?: string;
  knownRegions: string[];
  /** PBXProject attributes such as LastUpgradeCheck ("2710" = Xcode 27.1) and LastSwiftUpdateCheck. */
  attributes: Record<string, string>;
  targets: PbxTarget[];
}

function asDict(v: PlistValue | undefined): Dict {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {};
}

function asArray(v: PlistValue | undefined): PlistValue[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: PlistValue | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function readPbxproj(text: string): PbxProject {
  const root = asDict(parseOpenStepPlist(text));
  const objects = asDict(root.objects);
  const project = asDict(objects[asString(root.rootObject) ?? '']);

  const settingsFor = (listId: string | undefined): Record<string, Record<string, string>> => {
    const list = asDict(objects[listId ?? '']);
    const out: Record<string, Record<string, string>> = {};
    for (const confId of asArray(list.buildConfigurations)) {
      const conf = asDict(objects[asString(confId) ?? '']);
      const name = asString(conf.name) ?? 'Unknown';
      const bs = asDict(conf.buildSettings);
      out[name] = Object.fromEntries(
        Object.entries(bs).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' ') : String(v)]),
      );
    }
    return out;
  };

  const projectSettings = settingsFor(asString(project.buildConfigurationList));

  const targets: PbxTarget[] = [];
  for (const tid of asArray(project.targets)) {
    const id = asString(tid) ?? '';
    const t = asDict(objects[id]);
    if (asString(t.isa) !== 'PBXNativeTarget') continue;
    const own = settingsFor(asString(t.buildConfigurationList));
    // Target settings inherit from project-level settings.
    const merged: Record<string, Record<string, string>> = {};
    for (const conf of new Set([...Object.keys(projectSettings), ...Object.keys(own)])) {
      merged[conf] = { ...(projectSettings[conf] ?? {}), ...(own[conf] ?? {}) };
    }
    const synced = asArray(t.fileSystemSynchronizedGroups)
      .map((g) => asDict(objects[asString(g) ?? '']))
      .map((g) => asString(g.path))
      .filter((p): p is string => Boolean(p));
    targets.push({
      id,
      name: asString(t.name) ?? id,
      productType: asString(t.productType) ?? '',
      productName: asString(t.productName),
      buildSettings: merged,
      syncedFolders: synced,
      dependencies: asArray(t.dependencies).map((d) => asString(d) ?? ''),
    });
  }

  const attributes = Object.fromEntries(
    Object.entries(asDict(project.attributes)).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );

  return {
    developmentRegion: asString(project.developmentRegion),
    attributes,
    knownRegions: asArray(project.knownRegions).map((r) => asString(r) ?? '').filter(Boolean),
    targets,
  };
}

/** Pick the most representative configuration (Release, else the first one). */
export function settingsOf(target: PbxTarget, prefer = 'Release'): Record<string, string> {
  return target.buildSettings[prefer] ?? Object.values(target.buildSettings)[0] ?? {};
}

/** Resolve `$(VAR)` / `${VAR}` references inside a build setting value. */
export function expandSetting(value: string, settings: Record<string, string>, extra: Record<string, string> = {}): string {
  return value.replace(/\$[({]([A-Za-z0-9_]+)(?::[^)}]*)?[)}]/g, (_, name: string) => extra[name] ?? settings[name] ?? '');
}
