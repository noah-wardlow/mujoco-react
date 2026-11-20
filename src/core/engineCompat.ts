import type { MujocoModel, MujocoModule } from '../types';

// Boolean model arrays that the MuJoCo 3.9-3.14 bindings cannot read, keyed by
// the count that sizes them. mj_printModel reports each once per object.
const booleanFields = {
  actuator_actearly: 'nu', actuator_actlimited: 'nu', actuator_ctrllimited: 'nu', actuator_forcelimited: 'nu',
  eq_active0: 'neq', flex_centered: 'nflex', flex_flatskin: 'nflex', flex_internal: 'nflex', flex_rigid: 'nflex',
  jnt_actfrclimited: 'njnt', jnt_actgravcomp: 'njnt', jnt_limited: 'njnt',
  light_active: 'nlight', light_castshadow: 'nlight', mat_texuniform: 'nmat',
  tendon_actfrclimited: 'ntendon', tendon_limited: 'ntendon',
} as const;

const normalized = new WeakSet<object>();

/**
 * Gives models from older supported engines (MuJoCo 3.8.1+) the field shapes the
 * library reads from MuJoCo 4. Missing or unreadable fields become read-only copies.
 */
export function normalizeModel(mujoco: MujocoModule, model: MujocoModel): MujocoModel {
  if (normalized.has(model)) return model;
  normalized.add(model);
  const fields = model as unknown as Record<string, unknown>;
  const define = (name: string, value: unknown) => Object.defineProperty(model, name, { value, enumerable: true });

  // Before MuJoCo 3.11 every actuator owns exactly one control.
  if (fields.nactuator === undefined) define('nactuator', model.nu);
  if (fields.actuator_ctrlnum === undefined) {
    define('actuator_ctrlnum', new Int32Array(model.nu).fill(1));
    define('actuator_ctrladr', Int32Array.from({ length: model.nu }, (_, i) => i));
  }
  // Before MuJoCo 3.14 texture addresses are int64.
  if (fields.tex_adr instanceof BigInt64Array) define('tex_adr', Int32Array.from(fields.tex_adr, Number));

  const unreadable = Object.keys(booleanFields).filter((name) => {
    try { fields[name]; return false; } catch { return true; }
  }) as (keyof typeof booleanFields)[];
  if (unreadable.length) {
    const path = '/mujoco-react-model-print.txt';
    let text: string;
    try { mujoco.mj_printModel(model, path); text = mujoco.FS.readFile(path, { encoding: 'utf8' }) as string; }
    finally { try { mujoco.FS.unlink(path); } catch { /* print may fail before file creation */ } }
    const values = new Map(unreadable.map((name) => [name, [] as number[]]));
    for (const [, name, value] of text.matchAll(new RegExp(`^ +(${unreadable.join('|')}) +(\\d+)`, 'gm'))) {
      values.get(name as keyof typeof booleanFields)!.push(Number(value));
    }
    for (const [name, list] of values) {
      // Fields the print omits (or a count mismatch) keep the engine's behavior.
      if (list.length === fields[booleanFields[name]]) define(name, Uint8Array.from(list));
    }
  }
  return model;
}
