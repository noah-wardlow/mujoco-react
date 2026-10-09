import type { MujocoModule, MujocoModel, MujocoData, StateSnapshot } from '../types';

const threadCounts = new WeakMap<MujocoModule, number>();
export function configureModuleThreads(module: MujocoModule, count: number) {
  threadCounts.set(module, count);
}
export function initializeDataThreads(module: MujocoModule, data: MujocoData) {
  const count = threadCounts.get(module) ?? 0;
  if (count > 0) module.mju_threadpool(data, count);
}

export function captureSimulationState(
  module: MujocoModule,
  model: MujocoModel,
  data: MujocoData,
): StateSnapshot {
  const signature = module.mjtState.mjSTATE_INTEGRATION.value;
  const buffer = new module.DoubleBuffer(module.mj_stateSize(model, signature));
  try {
    module.mj_getState(model, data, buffer, signature);
    return {
      time: data.time,
      qpos: new Float64Array(data.qpos),
      qvel: new Float64Array(data.qvel),
      ctrl: new Float64Array(data.ctrl),
      act: new Float64Array(data.act),
      qfrc_applied: new Float64Array(data.qfrc_applied),
      integration: { signature, values: new Float64Array(buffer.GetView()), model },
    };
  } finally {
    buffer.delete();
  }
}

export function restoreSimulationState(
  module: MujocoModule,
  model: MujocoModel,
  data: MujocoData,
  snapshot: StateSnapshot,
) {
  const integration = snapshot.integration;
  if (
    integration &&
    (integration.model !== model ||
      integration.values.length !== module.mj_stateSize(model, integration.signature))
  ) {
    throw new Error('Snapshot belongs to a different model; capture a new snapshot after loading a scene');
  }
  for (const key of ['qpos', 'qvel', 'ctrl', 'act', 'qfrc_applied'] as const) {
    if (snapshot[key].length !== data[key].length)
      throw new Error(`Snapshot ${key} size does not match model`);
  }
  if (integration) module.mj_setState(model, data, Array.from(integration.values), integration.signature);
  // Preserve editable legacy fields; the packed state supplies mocap/history/etc.
  data.time = snapshot.time;
  for (const key of ['qpos', 'qvel', 'ctrl', 'act', 'qfrc_applied'] as const) data[key].set(snapshot[key]);
  module.mj_forward(model, data);
}
