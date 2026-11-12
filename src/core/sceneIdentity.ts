import type { SceneConfig } from '../types';
const fileIds = new WeakMap<object, number>();
let nextFileId = 0;
/** Model inputs define lifetime. Callback identity never recompiles physics. */
export function sceneIdentity(config: SceneConfig): string {
  return JSON.stringify([
    config.src, config.sceneFile, config.environmentFiles ?? [], config.sceneObjects ?? [],
    config.homeJoints ?? [], config.xmlPatches ?? [], (config.files ?? []).map(file => {
      if (!fileIds.has(file)) fileIds.set(file, ++nextFileId);
      return fileIds.get(file);
    }),
  ], (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : value);
}
