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
  /** Generated resource module. Defaults to `src/mujoco-register.gen.ts`. */
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
  let generatedRegister = options.generatedRegister ?? 'src/mujoco-register.gen.ts';
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
    transform(code: string, id: string) {
      if (!shouldInjectRegisterImport(id, root, generatedRegister)) return;
      return `${renderGeneratedImport(id, generatedRegister)}\n${code}`;
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
  const declarationsOnly = out.endsWith('.d.ts');

  for (const model of models) {
    await scanModel(path.resolve(root, model.file), root, seen, model.names);
    mergeNames(names, model.names);
  }

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, renderRegister(moduleName, names, models, declarationsOnly), 'utf8');

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
  models: readonly ModelEntry[],
  declarationsOnly: boolean
): string {
  const fields = REGISTER_KEYS
    .filter((key) => names[key].size > 0)
    .map((key) => `    ${key}: ${renderUnion(names[key])};`);
  const robots = models
    .map((model) => `      ${quoteProperty(model.id)}: {\n${renderRobotFields(model.names)}\n      };`);
  const namespaceAliases = renderNamespaceAliases(models);
  const registerImport = declarationsOnly ? '' : `import { registerRobotResources } from '${moduleName}';\n`;
  const resources = declarationsOnly ? '' : `${renderResourceTypes(models)}\n\n${renderResourceConstants(models)}\n\nregisterRobotResources(generatedRobotResources);\n\n`;

  return `// Auto-generated by mujoco-react. Do not edit.
// Regenerate by running Vite with the mujocoReact() plugin or \`mujoco-react codegen\`.

${registerImport}import type { RobotResource } from '${moduleName}';

${resources}declare module '${moduleName}' {
  interface Register {
    robots: {
${robots.join('\n')}
    };
${fields.join('\n')}
  }

${namespaceAliases}
}
`;
}

function renderResourceTypes(models: readonly ModelEntry[]): string {
  const modelTypes = models
    .map((model) => `  readonly ${quoteProperty(model.id)}: {\n${renderResourceTypeFields(model.names)}\n  };`)
    .join('\n');
  return `type GeneratedRobotResources = {\n${modelTypes}\n};`;
}

function renderResourceTypeFields(names: Record<RegisterKey, Set<string>>): string {
  return REGISTER_KEYS
    .map((key) => `    readonly ${key}: ${renderResourceObjectType(names[key])};`)
    .join('\n');
}

function renderResourceObjectType(values: Set<string>): string {
  const entries = sortedValues(values)
    .map((value) => `      readonly ${quoteProperty(value)}: '${escapeTs(value)}';`);
  return entries.length > 0 ? `{\n${entries.join('\n')}\n    }` : '{}';
}

function renderResourceConstants(models: readonly ModelEntry[]): string {
  const entries = models
    .map((model) => `  ${quoteProperty(model.id)}: {\n${renderResourceConstantFields(model.names)}\n  },`)
    .join('\n');
  return `const generatedRobotResources: GeneratedRobotResources = {\n${entries}\n};`;
}

function renderResourceConstantFields(names: Record<RegisterKey, Set<string>>): string {
  return REGISTER_KEYS
    .map((key) => `    ${key}: ${renderResourceObject(names[key])},`)
    .join('\n');
}

function renderResourceObject(values: Set<string>): string {
  const entries = sortedValues(values)
    .map((value) => `      ${quoteProperty(value)}: '${escapeTs(value)}',`);
  return entries.length > 0 ? `{\n${entries.join('\n')}\n    }` : '{}';
}

function renderRobotFields(names: Record<RegisterKey, Set<string>>): string {
  return REGISTER_KEYS
    .map((key) => `        ${key}: ${names[key].size > 0 ? renderUnion(names[key]) : 'never'};`)
    .join('\n');
}

function renderUnion(values: Set<string>): string {
  return sortedValues(values).map((value) => `'${escapeTs(value)}'`).join(' | ');
}

function renderNamespaceAliases(models: readonly ModelEntry[]): string {
  const namespaces: Record<RegisterKey, string> = {
    actuators: 'RobotActuators',
    sensors: 'RobotSensors',
    bodies: 'RobotBodies',
    joints: 'RobotJoints',
    sites: 'RobotSites',
    geoms: 'RobotGeoms',
    keyframes: 'RobotKeyframes',
  };

  const blocks = REGISTER_KEYS
    .map((key) => {
      const aliases = models
        .filter((model) => isIdentifier(model.id))
        .map((model) => `    export type ${model.id} = RobotResource<'${escapeTs(model.id)}', '${key}'>;`);
      if (aliases.length === 0) return '';
      return `  export namespace ${namespaces[key]} {\n${aliases.join('\n')}\n  }`;
    })
    .filter(Boolean)
    .join('\n\n');

  return blocks ? `${blocks}\n` : '';
}

function escapeTs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sortedValues(values: Set<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function quoteProperty(value: string): string {
  return isIdentifier(value) ? value : `'${escapeTs(value)}'`;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function shouldInjectRegisterImport(id: string, root: string, generatedRegister: string): boolean {
  if (generatedRegister.endsWith('.d.ts')) return false;
  const file = stripQuery(id);
  if (!/\.[cm]?[jt]sx?$/.test(file)) return false;
  if (file.includes(`${path.sep}node_modules${path.sep}`)) return false;
  const absolute = path.resolve(file);
  if (absolute === generatedRegister) return false;
  return absolute.startsWith(root);
}

function renderGeneratedImport(id: string, generatedRegister: string): string {
  const fromDir = path.dirname(stripQuery(id));
  let relative = toPosixPath(path.relative(fromDir, generatedRegister));
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return `import '${relative}';`;
}

function stripQuery(id: string): string {
  return id.split('?')[0];
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
