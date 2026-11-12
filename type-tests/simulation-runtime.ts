import type { MujocoSimAPI, SimulationRuntime, RuntimeSnapshot, RuntimeState, PhysicsPerformance, MujocoCanvasProps } from '../src';
declare const api: MujocoSimAPI;
declare const runtime: SimulationRuntime;
const create: Promise<SimulationRuntime> = api.createRuntime();
const state: Promise<RuntimeState> = runtime.advance({ steps: 10, controls: new Float64Array(2), signal: new AbortController().signal });
const snapshot: Promise<RuntimeSnapshot> = runtime.saveState();
const observe = runtime.observe({ streams: [{ key: 'front', position: [0, 0, 2], lookAt: [0, 0, 0], width: 224, height: 224 }] });
const performance: PhysicsPerformance = api.getPerformance();
const budget: MujocoCanvasProps['physicsBudgetMs'] = 8;
// @ts-expect-error a step count is required
runtime.advance({ controls: [0] });
// @ts-expect-error runtime snapshots carry ownership and full integration state
runtime.restoreState({ qpos: [0], qvel: [0] });
// @ts-expect-error worker observations are asynchronous
const sync: RuntimeState = runtime.observe();
void [create, state, snapshot, observe, performance, budget, sync];
