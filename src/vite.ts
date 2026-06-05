/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ViteConfig = { root: string };
type ViteServer = {
  watcher: {
    add(paths: string | string[]): void;
    on(event: 'add' | 'change' | 'unlink', listener: (file: string) => void): void;
  };
};

export interface MujocoReactPluginOptions {
  /** Entry MJCF/URDF files to scan. Prefer a record for stable per-robot type names. */
  models: ModelInput;
  /** Generated declaration file. Defaults to `src/mujoco-register.gen.d.ts`. */
  generatedRegister?: string;
  /** Module name to augment. Defaults to `mujoco-react`. */
  moduleName?: string;
  /** Disable console output. */
  disableLogging?: boolean;
}

export interface MujocoRegisterCodegenOptions {
  models: ModelInput;
  out: string;
  moduleName?: string;
  root?: string;
}

export interface MujocoRegisterCodegenResult {
  out: string;
  files: string[];
  counts: Record<RegisterKey, number>;
}

type RegisterKey = 'actuators' | 'sensors' | 'bodies' | 'joints' | 'sites' | 'geoms' | 'keyframes';
export type ModelInput = string | readonly string[] | Record<string, string>;

interface ModelEntry {
  id: string;
  file: string;
  names: Record<RegisterKey, Set<string>>;
}

const REGISTER_KEYS: RegisterKey[] = ['actuators', 'sensors', 'bodies', 'joints', 'sites', 'geoms', 'keyframes'];
const MODEL_EXTENSIONS = new Set(['.xml', '.mjcf', '.urdf']);

function createEmptyNames(): Record<RegisterKey, Set<string>> {
  return {
    actuators: new Set(),
    sensors: new Set(),
    bodies: new Set(),
    joints: new Set(),
    sites: new Set(),
    geoms: new Set(),
    keyframes: new Set(),
  };
}

export function mujocoReact(options: MujocoReactPluginOptions) {
  const models = normalizeModels(options.models);
  let root = process.cwd();
  let generatedRegister = options.generatedRegister ?? 'src/mujoco-register.gen.d.ts';
  let watchedFiles: string[] = [];

  async function generate() {
    const result = await generateMujocoRegister({
      models: options.models,
      out: generatedRegister,
      moduleName: options.moduleName,
      root,
    });
    watchedFiles = result.files;
    if (!options.disableLogging) {
      const total = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
      console.log(`[mujoco-react] generated ${path.relative(root, result.out)} (${total} names)`);
    }
    return result;
  }

  return {
    name: 'mujoco-react',
    enforce: 'pre' as const,
    configResolved(config: ViteConfig) {
      root = config.root;
      generatedRegister = path.resolve(root, generatedRegister);
    },
    async buildStart(this: { addWatchFile?: (file: string) => void }) {
      const result = await generate();
      for (const file of result.files) this.addWatchFile?.(file);
    },
    configureServer(server: ViteServer) {
      generate().then((result) => server.watcher.add(result.files)).catch((error: unknown) => {
        console.error('[mujoco-react] register generation failed', error);
      });

      server.watcher.on('add', regenerateIfModelFile);
      server.watcher.on('change', regenerateIfModelFile);
      server.watcher.on('unlink', regenerateIfModelFile);

      function regenerateIfModelFile(file: string) {
        if (!shouldRegenerate(file, watchedFiles, models, root)) return;
        generate().then((result) => server.watcher.add(result.files)).catch((error: unknown) => {
          console.error('[mujoco-react] register generation failed', error);
        });
      }
    },
  };
}

export async function generateMujocoRegister(
  options: MujocoRegisterCodegenOptions
): Promise<MujocoRegisterCodegenResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const out = path.resolve(root, options.out);
  const moduleName = options.moduleName ?? 'mujoco-react';
  const models = normalizeModels(options.models);
  const names = createEmptyNames();
  const seen = new Set<string>();

  for (const model of models) {
    await scanModel(path.resolve(root, model.file), root, seen, model.names);
    mergeNames(names, model.names);
  }

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, renderRegister(moduleName, names, models), 'utf8');

  return {
    out,
    files: [...seen].sort((a, b) => a.localeCompare(b)),
    counts: Object.fromEntries(REGISTER_KEYS.map((key) => [key, names[key].size])) as Record<RegisterKey, number>,
  };
}

async function scanModel(
  filePath: string,
  root: string,
  seen: Set<string>,
  names: Record<RegisterKey, Set<string>>
) {
  const normalized = path.normalize(filePath);
  if (seen.has(normalized)) return;
  seen.add(normalized);

  const xml = await readFile(normalized, 'utf8');
  collectSimpleTagNames(xml, 'body', names.bodies);
  collectSimpleTagNames(xml, 'joint', names.joints);
  collectSimpleTagNames(xml, 'site', names.sites);
  collectSimpleTagNames(xml, 'geom', names.geoms);
  collectSimpleTagNames(xml, 'key', names.keyframes);
  collectSectionNames(xml, 'actuator', names.actuators);
  collectSectionNames(xml, 'sensor', names.sensors);

  for (const includePath of collectIncludePaths(xml)) {
    const next = path.resolve(path.dirname(normalized), includePath);
    if (next.startsWith(root)) await scanModel(next, root, seen, names);
  }
}

function collectSimpleTagNames(xml: string, tag: string, target: Set<string>) {
  const pattern = new RegExp(`<\\s*${tag}\\b([^>]*)>`, 'gi');
  for (const match of xml.matchAll(pattern)) {
    const name = readAttr(match[1], 'name');
    if (name) target.add(name);
  }
}

function collectSectionNames(xml: string, section: string, target: Set<string>) {
  const sectionPattern = new RegExp(`<\\s*${section}\\b[^>]*>([\\s\\S]*?)<\\s*/\\s*${section}\\s*>`, 'gi');
  for (const sectionMatch of xml.matchAll(sectionPattern)) {
    const tagPattern = /<\s*[a-zA-Z0-9_:-]+\b([^>]*)>/g;
    for (const tagMatch of sectionMatch[1].matchAll(tagPattern)) {
      const name = readAttr(tagMatch[1], 'name');
      if (name) target.add(name);
    }
  }
}

function collectIncludePaths(xml: string): string[] {
  const result: string[] = [];
  const pattern = /<\s*include\b([^>]*)>/gi;
  for (const match of xml.matchAll(pattern)) {
    const file = readAttr(match[1], 'file');
    if (file && !file.includes('://') && !file.startsWith('/')) result.push(file);
  }
  return result;
}

function readAttr(attrs: string, attr: string): string | undefined {
  const pattern = new RegExp(`\\b${attr}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  return attrs.match(pattern)?.[2];
}

function renderRegister(
  moduleName: string,
  names: Record<RegisterKey, Set<string>>,
  models: readonly ModelEntry[]
): string {
  const fields = REGISTER_KEYS
    .filter((key) => names[key].size > 0)
    .map((key) => `    ${key}: ${renderUnion(names[key])};`);
  const robots = models
    .map((model) => `      ${quoteProperty(model.id)}: {\n${renderRobotFields(model.names)}\n      };`);

  return `// Auto-generated by mujoco-react. Do not edit.
// Regenerate by running Vite with the mujocoReact() plugin or \`mujoco-react codegen\`.

import 'mujoco-react';

declare module '${moduleName}' {
  interface Register {
    robots: {
${robots.join('\n')}
    };
${fields.join('\n')}
  }
}
`;
}

function renderRobotFields(names: Record<RegisterKey, Set<string>>): string {
  return REGISTER_KEYS
    .map((key) => `        ${key}: ${names[key].size > 0 ? renderUnion(names[key]) : 'never'};`)
    .join('\n');
}

function renderUnion(values: Set<string>): string {
  return [...values].sort((a, b) => a.localeCompare(b)).map((value) => `'${escapeTs(value)}'`).join(' | ');
}

function escapeTs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function quoteProperty(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : `'${escapeTs(value)}'`;
}

function normalizeModels(input: ModelInput): ModelEntry[] {
  if (typeof input === 'string') return [createModelEntry(deriveModelId(input), input)];
  if (Array.isArray(input)) return input.map((file) => createModelEntry(deriveModelId(file), file));
  return Object.entries(input).map(([id, file]) => createModelEntry(sanitizeModelId(id), file));
}

function createModelEntry(id: string, file: string): ModelEntry {
  return { id, file, names: createEmptyNames() };
}

function deriveModelId(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const filename = parts.at(-1) ?? 'model';
  const parent = parts.length > 1 ? parts.at(-2) : undefined;
  const base = filename.replace(/\.(xml|mjcf|urdf)$/i, '');
  return sanitizeModelId(parent && ['scene', 'model', 'robot'].includes(base.toLowerCase()) ? parent : base);
}

function sanitizeModelId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^[^A-Za-z_$]+/, '');
  return sanitized || 'model';
}

function mergeNames(target: Record<RegisterKey, Set<string>>, source: Record<RegisterKey, Set<string>>) {
  for (const key of REGISTER_KEYS) {
    for (const value of source[key]) target[key].add(value);
  }
}

function shouldRegenerate(file: string, watchedFiles: string[], models: readonly ModelEntry[], root: string): boolean {
  const absolute = path.resolve(file);
  if (watchedFiles.includes(absolute)) return true;
  if (!MODEL_EXTENSIONS.has(path.extname(absolute).toLowerCase())) return false;
  const modelDirs = models.map((model) => path.dirname(path.resolve(root, model.file)));
  return modelDirs.some((dir) => absolute.startsWith(dir));
}
