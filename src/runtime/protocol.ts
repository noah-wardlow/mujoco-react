import type { MainModule } from '@mujoco/mujoco';
import { SimulationEngine, type DisplayState, type EngineInitialization, type EngineState } from './engine';
export type Request = { id: number } & (
  { kind: 'initialize'; initial: EngineInitialization } |
  { kind: 'advance'; steps: number; controls?: Float64Array } |
  { kind: 'restore'; state: EngineState } |
  { kind: 'reset' | 'snapshot' | 'cancel' | 'ack' }
);
export interface Response {
  id: number; done: boolean; display?: DisplayState; error?: string;
  cancelled?: boolean; steps?: number; physicsMs?: number;
}
/** Same protocol is exercised with a real engine in worker-thread tests. */
export function createRuntimeHandler(load: () => Promise<MainModule>, send: (response: Response) => void) {
  let engine: SimulationEngine | undefined;
  let generation = 0;
  let busy = false;
  let displayPending = false;
  return async (request: Request) => {
    if (request.kind === 'ack') { displayPending = false; return; }
    if (request.kind === 'cancel') { generation++; return; }
    if (busy) { send({ id: request.id, done: true, error: 'Runtime is busy; await the current operation' }); return; }
    busy = true;
    const current = generation;
    let steps = 0, physicsMs = 0;
    try {
      if (request.kind === 'initialize') {
        if (engine) throw new Error('Runtime is already initialized');
        engine = new SimulationEngine(await load(), request.initial);
      } else if (!engine) throw new Error('Runtime is not initialized');
      else if (request.kind === 'reset') engine.reset();
      else if (request.kind === 'restore') engine.restore(request.state);
      else if (request.kind === 'advance') {
        if (!Number.isSafeInteger(request.steps) || request.steps <= 0) throw new Error('Steps must be a positive safe integer');
        engine.setControls(request.controls);
        let lastDisplay = performance.now();
        while (steps < request.steps && generation === current) {
          const sliceStart = performance.now();
          do {
            const start = performance.now();
            engine.step();
            physicsMs += performance.now() - start;
            steps++;
          } while (steps < request.steps && performance.now() - sliceStart < 8);
          if (!displayPending && performance.now() - lastDisplay >= 32) {
            displayPending = true;
            send({ id: request.id, done: false, display: engine.snapshot(false) });
            lastDisplay = performance.now();
          }
          // A task yield is required: a microtask alone starves cancel messages.
          if (steps < request.steps) await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      send({ id: request.id, done: true, display: engine!.snapshot(), cancelled: generation !== current, steps, physicsMs });
    } catch (error) {
      send({ id: request.id, done: true, error: error instanceof Error ? error.message : String(error) });
    } finally { busy = false; displayPending = false; }
  };
}
