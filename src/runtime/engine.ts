import type { MainModule, MjModel, MjData } from '@mujoco/mujoco';
import type { ContactInfo } from '../types';

export const displayFields = ['qpos', 'qvel', 'ctrl', 'act', 'plastic', 'sensordata', 'xpos', 'xquat', 'xmat',
  'geom_xpos', 'geom_xmat', 'site_xpos', 'site_xmat', 'cam_xpos', 'cam_xmat',
  'flexvert_xpos', 'ten_length', 'wrap_xpos', 'cvel', 'cfrc_ext', 'qfrc_applied', 'xfrc_applied', 'qfrc_bias', 'ten_wrapadr', 'ten_wrapnum'] as const;
export interface EngineState { signature: number; values: Float64Array }
export interface EngineInitialization { model: Uint8Array; state: EngineState }
export interface DisplayState {
  time: number;
  fields: Record<typeof displayFields[number], Float64Array>;
  contacts: ContactInfo[];
  integration?: EngineState;
}
export class SimulationEngine {
  readonly model: MjModel;
  readonly data: MjData;
  constructor(private mj: MainModule, private initial: EngineInitialization) {
    mj.FS.writeFile('/runtime.mjb', initial.model);
    const vfs = new mj.MjVFS();
    try { this.model = mj.MjModel.from_binary_path('/runtime.mjb', vfs); }
    finally { vfs.delete(); mj.FS.unlink('/runtime.mjb'); }
    this.data = new mj.MjData(this.model);
    try { this.reset(); } catch (error) { this.dispose(); throw error; }
  }
  reset() {
    this.mj.mj_resetData(this.model, this.data);
    this.restore(this.initial.state);
  }
  restore(state: EngineState) {
    if (state.signature !== this.mj.mjtState.mjSTATE_INTEGRATION.value ||
      state.values.length !== this.mj.mj_stateSize(this.model, state.signature) ||
      !state.values.every(Number.isFinite)) throw new Error('Invalid runtime snapshot');
    this.mj.mj_setState(this.model, this.data, Array.from(state.values), state.signature);
    this.mj.mj_forward(this.model, this.data);
  }
  setControls(controls?: Float64Array) {
    if (controls) {
      if (controls.length !== this.data.ctrl.length || !controls.every(Number.isFinite)) throw new Error('Invalid runtime controls');
      this.data.ctrl.set(controls);
    }
  }
  step() {
    const expected = this.data.time + this.model.opt.timestep;
    this.mj.mj_step(this.model, this.data);
    if (Math.abs(this.data.time - expected) > 1e-7 || !this.data.qpos.every(Number.isFinite)) {
      throw new Error('Physics became unstable or reset unexpectedly');
    }
  }
  save(): EngineState {
    const signature = this.mj.mjtState.mjSTATE_INTEGRATION.value;
    const buffer = new this.mj.DoubleBuffer(this.mj.mj_stateSize(this.model, signature));
    try {
      this.mj.mj_getState(this.model, this.data, buffer, signature);
      return { signature, values: new Float64Array(buffer.GetView()) };
    } finally { buffer.delete(); }
  }
  snapshot(complete = true): DisplayState {
    const integration = complete ? this.save() : undefined;
    // mj_step integrates qpos after computing derived fields. Refresh completed
    // observations at their reported time, preserving solver warmstart exactly.
    if (integration) this.mj.mj_forward(this.model, this.data);
    try { return {
      time: this.data.time,
      fields: Object.fromEntries(displayFields.map(key => [key, new Float64Array(this.data[key])])) as DisplayState['fields'],
      contacts: complete ? this.contacts() : [],
      ...(integration ? { integration } : {}),
    }; } finally {
      if (integration) this.mj.mj_setState(this.model, this.data, Array.from(integration.values), integration.signature);
    }
  }
  private contacts(): ContactInfo[] {
    const result: ContactInfo[] = [], vector = this.data.contact;
    const names = this.model.names, addresses = this.model.name_geomadr;
    const name = (id: number) => {
      if (id < 0) return 'flex';
      const start = addresses[id]; let end = start;
      while (end < names.length && names[end]) end++;
      return new TextDecoder().decode(names.subarray(start, end));
    };
    try {
      for (let i = 0; i < this.data.ncon; i++) {
        const c = vector.get(i);
        if (!c) continue;
        try { result.push({ geom1: c.geom1, geom2: c.geom2, geom1Name: name(c.geom1), geom2Name: name(c.geom2),
          pos: Array.from(c.pos) as [number, number, number], depth: c.dist }); }
        finally { c.delete(); }
      }
    } finally { vector.delete(); }
    return result;
  }
  dispose() { this.data.delete(); this.model.delete(); }
}
