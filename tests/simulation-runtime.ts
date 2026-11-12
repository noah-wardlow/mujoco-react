import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import loadMujoco from '@mujoco/mujoco';
import { captureSimulationState } from '../src/core/engineState';
import type { MujocoSimAPI, MujocoModule, MujocoModel, MujocoData } from '../src/types';
import { RuntimeClient, attachSimulationRuntime, closeModelRuntime } from '../src/runtime/client';
import { runStepBudget } from '../src/core/stepBudget';
import { sceneIdentity } from '../src/core/sceneIdentity';
import type { WorkerPort } from '../src/runtime/types';
import type { DisplayState } from '../src/runtime/engine';

const mj = await loadMujoco();
const xml = `<mujoco><option gravity="0 0 0"/><worldbody><body><joint name="slide" type="slide" stiffness="50" springyield=".1" damping="2"/><geom size=".1" mass="1"/></body></worldbody><actuator><motor joint="slide"/></actuator><sensor><jointpos joint="slide"/></sensor></mujoco>`;
function port(): WorkerPort {
  const worker = new Worker(new URL('./runtime-worker.js', import.meta.url));
  const adapter: WorkerPort = { postMessage: data => worker.postMessage(data), terminate: () => { void worker.terminate(); }, onmessage: null, onerror: null, onmessageerror: null };
  worker.on('message', data => adapter.onmessage?.({ data } as MessageEvent));
  worker.on('error', error => adapter.onerror?.({ message: error.message } as ErrorEvent));
  worker.on('messageerror', data => adapter.onmessageerror?.({ data } as MessageEvent));
  return adapter;
}
async function fixture(source = xml) {
  const model = mj.MjModel.from_xml_string(source), data = new mj.MjData(model);
  data.qpos[0] = .5; mj.mj_forward(model, data);
  const signature = mj.mjtState.mjSTATE_INTEGRATION.value;
  const state = new mj.DoubleBuffer(mj.mj_stateSize(model, signature));
  mj.mj_getState(model, data, state, signature);
  mj.mj_saveModel(model, '/runtime-test.mjb', null);
  let display: DisplayState | undefined;
  const client = new RuntimeClient(port(), value => { display = value; }, () => {});
  await client.initialize({ model: mj.FS.readFile('/runtime-test.mjb'), state: { signature, values: new Float64Array(state.GetView()) } });
  state.delete(); mj.FS.unlink('/runtime-test.mjb');
  return { model, data, client, display: () => display!, close: async () => { await client.dispose(); data.delete(); model.delete(); } };
}

test('real worker matches exact stepping, sensors, plasticity and snapshot replay', async () => {
  const f = await fixture();
  try {
    f.data.ctrl[0] = 1;
    for (let i = 0; i < 500; i++) mj.mj_step(f.model, f.data);
    const result = await f.client.advance({ steps: 500, controls: [1] });
    assert.deepEqual(Array.from(result.qpos), Array.from(f.data.qpos));
    assert.deepEqual(result.sensors, result.qpos, 'sensors reflect the completed step, not the preceding pose');
    assert.deepEqual(Array.from(f.display().fields.plastic), Array.from(f.data.plastic));
    const snapshot = await f.client.saveState();
    const expected = await f.client.advance({ steps: 100 });
    await f.client.reset(); await f.client.restoreState(snapshot);
    assert.deepEqual((await f.client.advance({ steps: 100 })).qpos, expected.qpos);
    const copy = f.client.state; copy.qpos.fill(999);
    assert.notEqual(f.client.state.qpos[0], 999);
    assert.equal(f.client.metrics.steps, 100);
    assert.ok(f.client.metrics.physicsMs > 0);
    assert.ok(f.client.metrics.realTimeFactor > 0);
  } finally { await f.close(); }
});

test('backpressure, cancellation and reset leave worker responsive and reject stale work', async () => {
  const f = await fixture();
  try {
    const advance = f.client.advance({ steps: 10000000 });
    const cancelled = assert.rejects(advance, { name: 'AbortError' });
    await assert.rejects(f.client.observe(), /busy/);
    await new Promise(resolve => setTimeout(resolve, 30));
    const start = performance.now();
    await f.client.reset(); await cancelled;
    assert.ok(performance.now() - start < 2000, 'reset can interrupt a long batch');
    assert.equal(f.client.state.time, 0);
    assert.equal(f.client.state.qpos[0], .5);
    assert.equal((await f.client.advance({ steps: 1 })).time, f.model.opt.timestep);
    await assert.rejects(f.client.advance({ steps: 1, controls: [NaN] }), /controls/);
    await assert.rejects(f.client.advance({ steps: Infinity }), /positive safe integer/);
    const signal = AbortSignal.abort();
    await assert.rejects(f.client.advance({ steps: 1, signal }), { name: 'AbortError' });
    assert.equal((await f.client.advance({ steps: 1 })).time, 2 * f.model.opt.timestep);
  } finally { await f.close(); }
});

test('snapshots are runtime-specific and disposed runtimes fail explicitly', async () => {
  const a = await fixture(), b = await fixture();
  try {
    await assert.rejects(b.client.restoreState(await a.client.saveState()), /different runtime/);
    await a.client.dispose();
    await assert.rejects(a.client.advance({ steps: 1 }), /disposed/);
  } finally { await a.close(); await b.close(); }
});

test('viewer budget yields after an expensive step and limits fast batches', () => {
  let time = 0;
  const costly = runStepBudget(1000, () => { time += 5; }, 8, () => time);
  assert.equal(costly.steps, 2); assert.equal(costly.budgetExceeded, true);
  assert.equal(runStepBudget(10000, () => {}, 8, () => 0).steps, 100);
  assert.throws(() => runStepBudget(1, () => {}, 0), /positive/);
});

test('equivalent inline configurations and callback changes preserve model lifetime', () => {
  const base = { src: '/models/', sceneFile: 'scene.xml', homeJoints: [1, 2], onReset: () => {} };
  assert.equal(sceneIdentity(base), sceneIdentity({ ...base, homeJoints: [1, 2], onReset: () => {} }));
  assert.equal(sceneIdentity({ ...base, xmlPatches: [{ target: 'body', inject: '<geom/>' }] }), sceneIdentity({ ...base, xmlPatches: [{ inject: '<geom/>', target: 'body' }] }));
  assert.notEqual(sceneIdentity(base), sceneIdentity({ ...base, homeJoints: [1, 3] }));
});


test('completed contact observations preserve the subsequent warmstarted trajectory', async () => {
  const f = await fixture(`<mujoco><worldbody><geom name="floor" type="plane" size="2 2 .1"/><body pos="0 0 .3"><freejoint/><geom name="ball" size=".1" mass="1"/></body></worldbody></mujoco>`);
  try {
    for (let i = 0; i < 500; i++) mj.mj_step(f.model, f.data);
    await f.client.advance({ steps: 500 });
    const observation = await f.client.observe();
    assert.ok(observation.contacts.some(c => c.geom1Name === 'floor' && c.geom2Name === 'ball'));
    const saved = await f.client.saveState();
    for (let i = 0; i < 5; i++) await f.client.observe();
    for (let i = 0; i < 100; i++) mj.mj_step(f.model, f.data);
    const result = await f.client.advance({ steps: 100 });
    assert.deepEqual(result.qpos, new Float64Array(f.data.qpos));
    await f.client.restoreState(saved);
    assert.deepEqual((await f.client.advance({ steps: 100 })).qpos, result.qpos);
  } finally { await f.close(); }
});


test('disposing worker ownership rebuilds native viewer contacts; unmount skips reconstruction', async () => {
  const model = mj.MjModel.from_xml_string(`<mujoco><worldbody><geom type="plane" size="2 2 .1"/><body pos="0 0 .3"><freejoint/><geom size=".1"/></body></worldbody></mujoco>`);
  const data = new mj.MjData(model);
  mj.mj_forward(model, data);
  const module = mj as unknown as MujocoModule;
  const m = model as unknown as MujocoModel, d = data as unknown as MujocoData;
  const api = { mjModelRef: { current: m }, mjDataRef: { current: d }, setPaused: () => {},
    saveState: () => captureSimulationState(module, m, d) } as unknown as MujocoSimAPI;
  let runtime = await attachSimulationRuntime(module, api, async () => {}, () => {}, { createWorker: port });
  try {
    assert.equal(data.ncon, 0);
    await runtime.advance({ steps: 500 });
    assert.ok(runtime.state.contacts.length > 0);
    assert.equal(data.ncon, 0, 'viewer native contacts are not recomputed while worker owns physics');
    await runtime.dispose();
    assert.ok(data.ncon > 0, 'native contacts are immediately available after disposal');
    runtime = await attachSimulationRuntime(module, api, async () => {}, () => {}, { createWorker: port });
    closeModelRuntime(m);
    await assert.rejects(runtime.advance({ steps: 1 }), /disposed/);
  } finally { await runtime.dispose(); data.delete(); model.delete(); }
});
