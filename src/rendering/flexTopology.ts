import type { MujocoModel } from '../types';

/** MuJoCo flex topology uses vertex indices local to each flex. */
export function getFlexTopology(
  model: MujocoModel,
  id: number,
): { kind: 'mesh' | 'lines' | 'points'; indices: number[] } {
  const dim = model.flex_dim[id];
  if (dim === 3) {
    const start = model.flex_shelldataadr[id];
    return {
      kind: 'mesh',
      indices: Array.from(model.flex_shell.subarray(start, start + 3 * model.flex_shellnum[id])),
    };
  }
  if (dim === 1 || dim === 2) {
    const start = model.flex_elemdataadr[id];
    return {
      kind: dim === 2 ? 'mesh' : 'lines',
      indices: Array.from(model.flex_elem.subarray(start, start + (dim + 1) * model.flex_elemnum[id])),
    };
  }
  return { kind: 'points', indices: [] };
}
