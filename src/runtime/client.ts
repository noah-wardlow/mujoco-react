import type { MainModule, MjModel } from '@mujoco/mujoco';
import type { MujocoModule, MujocoModel, MujocoSimAPI, PolicyCameraFrameCaptureOptions } from '../types';
import { capturePolicyCameraFrames } from '../policyCameraFrames';
import { displayFields, type DisplayState, type EngineInitialization } from './engine';
import type { Request, Response } from './protocol';
import type { RuntimeOptions, RuntimeState, RuntimeSnapshot, RuntimeMetrics, SimulationRuntime, WorkerPort, AdvanceOptions } from './types';

interface Owner { close: () => void; contacts: () => RuntimeState['contacts'] }
const owners = new WeakMap<MujocoModel, Owner>();
export const isWorkerOwned = (model: MujocoModel | null) => Boolean(model && owners.has(model));
export function closeModelRuntime(model: MujocoModel | null) { if (model) owners.get(model)?.close(); }
export function runtimeContacts(model: MujocoModel) { return owners.get(model)?.contacts(); }
export function assertMainThreadOwnership(model: MujocoModel | null) {
  if (isWorkerOwned(model)) throw new Error('Worker runtime owns this simulation. Use runtime operations or dispose it before using viewer physics operations.');
}
const abortError = () => new DOMException('Simulation operation cancelled', 'AbortError');

/** Client owns backpressure and cancellation; protocol owns authoritative engine state. */
export class RuntimeClient implements SimulationRuntime {
  private pending: { id: number; resolve: (r: Response) => void; reject: (e: Error) => void } | null = null;
  private nextId = 0;
  private closed = false;
  private busy = false;
  private flight: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private latest: RuntimeState = { time: 0, qpos: new Float64Array(), qvel: new Float64Array(), ctrl: new Float64Array(), sensors: new Float64Array(), contacts: [] };
  private statistics: RuntimeMetrics = { steps: 0, physicsMs: 0, elapsedMs: 0, realTimeFactor: 0, captureMs: 0, busy: false };
  private readonly modelId = crypto.randomUUID();
  constructor(
    private worker: WorkerPort,
    private apply: (display: DisplayState) => void,
    private release: (restoreViewer: boolean) => void,
    private capture?: (options: PolicyCameraFrameCaptureOptions) => ReturnType<typeof capturePolicyCameraFrames>,
  ) {
    worker.onmessage = event => {
      const response = event.data as Response;
      if (this.closed || response.id !== this.pending?.id) return;
      if (response.display) {
        try {
          this.apply(response.display);
          const f = response.display.fields;
          this.latest = { time: response.display.time, qpos: f.qpos, qvel: f.qvel, ctrl: f.ctrl, sensors: f.sensordata,
            contacts: response.done ? response.display.contacts : this.latest.contacts };
        } catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); return; }
      }
      if (!response.done) this.worker.postMessage({ kind: 'ack', id: response.id });
      if (response.done) {
        const pending = this.pending; this.pending = null;
        if (response.error) pending.reject(new Error(response.error));
        else pending.resolve(response);
      }
    };
    worker.onerror = event => this.close(new Error(event.message || 'Simulation worker failed'));
    worker.onmessageerror = () => this.close(new Error('Cannot read simulation worker response'));
  }
  get state(): RuntimeState {
    return { ...this.latest, qpos: this.latest.qpos.slice(), qvel: this.latest.qvel.slice(), ctrl: this.latest.ctrl.slice(), sensors: this.latest.sensors.slice(),
      contacts: this.latest.contacts.map(c => ({ ...c, pos: [...c.pos] as [number, number, number] })) };
  }
  get metrics() { return { ...this.statistics, busy: this.busy }; }
  private request(request: Omit<Request, 'id'>): Promise<Response> {
    if (this.closed) return Promise.reject(new Error('Simulation runtime is disposed'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending = { id, resolve, reject };
      try { this.worker.postMessage({ ...request, id }); }
      catch (error) { this.pending = null; reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Simulation runtime is disposed'));
    if (this.busy) return Promise.reject(new Error('Runtime is busy; await the current operation (work is not queued)'));
    this.busy = true;
    const result = operation().finally(() => { this.busy = false; });
    this.flight = result.catch(() => {});
    return result;
  }
  initialize(initial: EngineInitialization) {
    return this.exclusive(async () => { await this.request({ kind: 'initialize', initial } as Request); });
  }
  advance(options: AdvanceOptions) {
    return this.exclusive(async () => {
      if (options.signal?.aborted) throw abortError();
      const started = performance.now(), simStart = this.latest.time;
      const abort = () => { this.worker.postMessage({ kind: 'cancel', id: ++this.nextId }); };
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await this.request({ kind: 'advance', steps: options.steps,
          controls: options.controls ? Float64Array.from(options.controls) : undefined } as Request);
        const elapsedMs = performance.now() - started;
        this.statistics = { ...this.statistics, steps: result.steps ?? 0, physicsMs: result.physicsMs ?? 0, elapsedMs,
          realTimeFactor: (this.latest.time - simStart) * 1000 / Math.max(elapsedMs, .001) };
        if (result.cancelled || options.signal?.aborted) throw abortError();
        return this.state;
      } finally { options.signal?.removeEventListener('abort', abort); }
    });
  }
  observe(cameras?: PolicyCameraFrameCaptureOptions) {
    return this.exclusive(async () => {
      const generation = this.generation;
      await this.request({ kind: 'snapshot' });
      const state = this.state, started = performance.now();
      const frames = cameras ? await this.capture?.(cameras) : undefined;
      if (cameras && !frames) throw new Error('Camera observations require an attached canvas');
      this.statistics.captureMs = performance.now() - started;
      if (generation !== this.generation || this.closed) throw abortError();
      return { ...state, ...(frames ? { cameras: frames } : {}) };
    });
  }
  saveState() {
    return this.exclusive(async () => {
      const result = await this.request({ kind: 'snapshot' });
      const state = result.display!.integration!;
      return { modelId: this.modelId, signature: state.signature, values: state.values.slice() };
    });
  }
  restoreState(snapshot: RuntimeSnapshot) {
    return this.exclusive(async () => {
      if (snapshot.modelId !== this.modelId) throw new Error('Snapshot belongs to a different runtime');
      await this.request({ kind: 'restore', state: { signature: snapshot.signature, values: snapshot.values } } as Request);
      return this.state;
    });
  }
  async cancel() {
    if (this.closed) return;
    this.generation++;
    this.worker.postMessage({ kind: 'cancel', id: ++this.nextId });
    await this.flight;
  }
  async reset() {
    await this.cancel();
    return this.exclusive(async () => { await this.request({ kind: 'reset' }); return this.state; });
  }
  async dispose() { await this.cancel(); this.close(); }
  close(error = new Error('Simulation runtime disposed'), restoreViewer = true) {
    if (this.closed) return;
    this.closed = true; this.generation++;
    this.worker.terminate();
    this.pending?.reject(error); this.pending = null;
    this.release(restoreViewer);
  }
}

export async function attachSimulationRuntime(
  module: MujocoModule, api: MujocoSimAPI, waitForDisplay: () => Promise<void>, invalidate: () => void,
  options: RuntimeOptions = {},
): Promise<SimulationRuntime> {
  const model = api.mjModelRef.current, data = api.mjDataRef.current;
  if (!model || !data) throw new Error('Scene must be ready before creating a runtime');
  assertMainThreadOwnership(model);
  api.setPaused(true);
  const state = api.saveState().integration!;
  const initialState = { signature: state.signature, values: state.values };
  const mj = module as unknown as MainModule;
  const path = `/runtime-${crypto.randomUUID()}.mjb`;
  let binary: Uint8Array;
  try { mj.mj_saveModel(model as unknown as MjModel, path, null); binary = mj.FS.readFile(path); }
  finally { try { mj.FS.unlink(path); } catch { /* save may fail before file creation */ } }
  const worker = options.createWorker?.() ?? new Worker(new URL('./physics.worker.js', import.meta.url), { type: 'module' });
  let complete: DisplayState | undefined;
  const apply = (display: DisplayState) => {
    if (api.mjModelRef.current !== model) throw new Error('Simulation model changed');
    if (display.integration) {
      module.mj_setState(model, data, Array.from(display.integration.values), display.integration.signature);
      complete = display;
    }
    for (const field of displayFields) {
      const target = data[field];
      if (!(target instanceof Float64Array || target instanceof Int32Array) || target.length !== display.fields[field].length) throw new Error(`Invalid display field ${field}`);
      target.set(display.fields[field]);
    }
    data.time = display.time;
    invalidate();
  };
  const client = new RuntimeClient(worker, apply, restoreViewer => {
    // Revert partial display frames to the last acknowledged complete state.
    try {
      if (api.mjModelRef.current === model && complete) {
        apply(complete);
        // Native contact/constraint structures cannot be mirrored as typed arrays.
        // Rebuild once when returning ownership, never on progress frames or unmount.
        if (restoreViewer) {
          module.mj_forward(model, data);
          const state = complete.integration!;
          module.mj_setState(model, data, Array.from(state.values), state.signature);
        }
      }
    } finally { owners.delete(model); }
  }, async cameras => {
    await waitForDisplay();
    return capturePolicyCameraFrames(api, cameras);
  });
  owners.set(model, { close: () => client.close(undefined, false), contacts: () => client.state.contacts });
  try { await client.initialize({ model: binary, state: initialState }); return client; }
  catch (error) { client.close(); throw error; }
}
