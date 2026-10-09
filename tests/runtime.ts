import test from 'node:test';
import assert from 'node:assert/strict';
import loadMujoco from '@mujoco/mujoco';
import { Quaternion, Vector3, Matrix4 } from 'three';
import { GenericIK } from '../src/core/GenericIK';
import {
  getActuatorInfo,
  getActuatorControlAddress,
  writeActuatorControl,
  getControlMap,
} from '../src/core/SceneLoader';
import {
  captureSimulationState,
  restoreSimulationState,
  configureModuleThreads,
  initializeDataThreads,
} from '../src/core/engineState';
import { getFlexTopology } from '../src/rendering/flexTopology';
import type { MujocoModule, MujocoModel, MujocoData } from '../src/types';

const mj = await loadMujoco();
const module = mj as unknown as MujocoModule;
function fixture(xml: string) {
  const model = mj.MjModel.from_xml_string(xml) as unknown as MujocoModel;
  const data = new module.MjData(model);
  module.mj_forward(model, data);
  return {
    model,
    data,
    close() {
      data.delete();
      model.delete();
    },
  };
}
const scalarXml = `<mujoco><option gravity="0 0 0"/><worldbody>
<body pos="0 0 2"><freejoint/><geom size=".1"/></body>
<body><joint name="h" axis="0 0 1" range="-80 80"/><geom size=".1"/><site pos="1 0 0"/></body>
</worldbody><actuator><position name="motor" joint="h" kp="10"/></actuator></mujoco>`;
function siteQuat(data: MujocoData) {
  const r = data.site_xmat;
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1),
  );
}

test('analytic scalar IK uses dof addresses when nq differs from nv and restores live state', () => {
  const { model, data, close } = fixture(scalarXml);
  try {
    const saved = Array.from(data.qpos);
    let forwards = 0,
      jacobians = 0;
    const counted = Object.create(module) as MujocoModule;
    counted.mj_forward = (m, d) => {
      forwards++;
      module.mj_forward(m, d);
    };
    counted.mj_jacSite = (m, d, p, r, s) => {
      jacobians++;
      module.mj_jacSite(m, d, p, r, s);
    };
    const angle = 0.6;
    const q = new GenericIK(counted).solve(
      model,
      data,
      0,
      [7],
      new Vector3(Math.cos(angle), Math.sin(angle), 0),
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle),
      [0],
    );
    assert.ok(q && Math.abs(q[0] - angle) < 0.002);
    assert.deepEqual(Array.from(data.qpos), saved);
    assert.ok(
      jacobians > 0 && forwards <= jacobians + 2,
      `${forwards} forward calls for ${jacobians} Jacobians`,
    );
  } finally {
    close();
  }
});

test('ball IK integrates normalized quaternions, including a 180-degree target', () => {
  const { model, data, close } = fixture(
    `<mujoco><worldbody><body><joint type="ball"/><geom size=".1"/><site/></body></worldbody></mujoco>`,
  );
  try {
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const before = Array.from(data.qpos);
    const q = new GenericIK(module).solveJoints(model, data, 0, [0], new Vector3(), target, data.qpos, {
      maxIterations: 100,
      rotWeight: 1,
    });
    assert.ok(q);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-10);
    assert.deepEqual(Array.from(data.qpos), before);
    data.qpos.set(q);
    module.mj_forward(model, data);
    assert.ok(siteQuat(data).angleTo(target) < 0.002);
    assert.throws(
      () => new GenericIK(module).solve(model, data, 0, [0], new Vector3(), target, [0]),
      /solveJoints/,
    );
  } finally {
    close();
  }
});

test('free-joint IK solves translation and rotation', () => {
  const { model, data, close } = fixture(
    `<mujoco><worldbody><body><freejoint/><geom size=".1"/><site/></body></worldbody></mujoco>`,
  );
  try {
    const position = new Vector3(0.2, -0.3, 0.4),
      rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7);
    const q = new GenericIK(module).solveJoints(model, data, 0, [0], position, rotation);
    assert.ok(q);
    data.qpos.set(q);
    module.mj_forward(model, data);
    assert.ok(new Vector3(...Array.from(data.site_xpos)).distanceTo(position) < 0.003);
    assert.ok(siteQuat(data).angleTo(rotation) < 0.005);
  } finally {
    close();
  }
});

test('IK enforces scalar limits and restores qpos on engine failure', () => {
  const { model, data, close } = fixture(scalarXml);
  try {
    const target = new Vector3(0, 1, 0),
      rotation = new Quaternion();
    const solver = new GenericIK(module);
    const q = solver.solve(model, data, 0, [7], target, rotation, [0], {
      rotWeight: 0,
      jointLimits: [[-0.2, 0.2]],
    });
    assert.ok(q && q[0] <= 0.2 && q[0] >= -0.2);
    const before = Array.from(data.qpos);
    const bad = Object.create(module) as MujocoModule;
    bad.mj_jacSite = () => {
      throw new Error('injected Jacobian failure');
    };
    assert.throws(() => new GenericIK(bad).solve(model, data, 0, [7], target, rotation, [0]), /injected/);
    assert.deepEqual(Array.from(data.qpos), before);
  } finally {
    close();
  }
});

test('multi-input PID does not shift named scalar writes into the wrong channel', () => {
  const { model, data, close } = fixture(
    `<mujoco><worldbody><body><joint name="a"/><geom size=".1"/></body><body pos="1 0 0"><joint name="b"/><geom size=".1"/></body></worldbody><actuator><pid name="servo" joint="a" kp="10" kv="1" input="pos vel ff"/><position name="scalar" joint="b" kp="10"/></actuator></mujoco>`,
  );
  try {
    assert.equal(model.nactuator, 2);
    assert.equal(model.nu, 4);
    assert.equal(getActuatorInfo(model, 1).ctrlAdr, 3);
    assert.equal(getActuatorInfo(model, 0).ctrlCount, 3);
    writeActuatorControl(model, data, 0, [0.2, 0.3, 0.4]);
    writeActuatorControl(model, data, 1, 0.5);
    assert.deepEqual(Array.from(data.ctrl), [0.2, 0.3, 0.4, 0.5]);
    assert.equal(getActuatorControlAddress(model, 1), 3);
    assert.equal(getActuatorControlAddress(model, 0, 2), 2);
    assert.throws(() => writeActuatorControl(model, data, 0, 1), /per input/);
    assert.throws(() => getActuatorControlAddress(model, 0), /explicit/);
    assert.deepEqual(getControlMap(model).ctrlAdr, [3]);
  } finally {
    close();
  }
});

test('full snapshots restore mocap, external force, warmstart and subsequent trajectory', () => {
  const { model, data, close } = fixture(
    `<mujoco><worldbody><body mocap="true"><geom size=".1" contype="0" conaffinity="0"/></body><body pos="0 0 1"><freejoint/><geom size=".1"/></body></worldbody></mujoco>`,
  );
  try {
    (data.mocap_pos as Float64Array)[0] = 0.5;
    data.xfrc_applied[6] = 0.2;
    module.mj_step(model, data);
    const snapshot = captureSimulationState(module, model, data);
    module.mj_step(model, data);
    const expected = Array.from(data.qpos);
    (data.mocap_pos as Float64Array)[0] = 9;
    data.xfrc_applied.fill(0);
    restoreSimulationState(module, model, data, snapshot);
    assert.equal((data.mocap_pos as Float64Array)[0], 0.5);
    assert.equal(data.xfrc_applied[6], 0.2);
    module.mj_step(model, data);
    assert.deepEqual(Array.from(data.qpos), expected);
    assert.throws(
      () => restoreSimulationState(module, { ...model } as MujocoModel, data, snapshot),
      /different model/,
    );
  } finally {
    close();
  }
});

test('2D flex surfaces use the engine element topology', () => {
  const { model, close } = fixture(
    `<mujoco><worldbody><flexcomp name="cloth" type="grid" count="3 3 1" spacing=".1 .1 .1" dim="2" mass="1"><edge equality="true"/></flexcomp></worldbody></mujoco>`,
  );
  try {
    const topology = getFlexTopology(model, 0);
    assert.equal(topology.kind, 'mesh');
    assert.equal(topology.indices.length, 3 * model.flex_elemnum[0]);
    assert.ok(
      topology.indices.length > 0 && topology.indices.every((i) => i >= 0 && i < model.flex_vertnum[0]),
    );
  } finally {
    close();
  }
});

test('ball joint limits bound the rotation angle', () => {
  const { model, data, close } = fixture(
    `<mujoco><compiler angle="radian"/><worldbody><body><joint type="ball" limited="true" range="0 .4"/><geom size=".1"/><site/></body></worldbody></mujoco>`,
  );
  try {
    const q = new GenericIK(module).solveJoints(
      model,
      data,
      0,
      [0],
      new Vector3(),
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1),
    );
    assert.ok(q && 2 * Math.acos(Math.min(1, Math.abs(q[0]))) <= 0.400001);
  } finally {
    close();
  }
});

test('orientation controls reset to an identity quaternion', () => {
  const { model, data, close } = fixture(
    `<mujoco><worldbody><body><joint name="ball" type="ball"/><geom size=".1"/></body></worldbody><actuator><orientation name="servo" joint="ball" input="quat" kp="10"/></actuator></mujoco>`,
  );
  try {
    assert.equal(getActuatorInfo(model, 0).ctrlCount, 4);
    writeActuatorControl(model, data, 0, [0, 1, 0, 0]);
    module.mj_resetCtrl(model, data);
    assert.deepEqual(Array.from(data.ctrl), [1, 0, 0, 0]);
  } finally {
    close();
  }
});

test('threaded WASM creates and frees a simulation thread pool', async () => {
  const { default: loadThreaded } = await import('@mujoco/mujoco/mt');
  const mt = await loadThreaded();
  const model = mt.MjModel.from_xml_string(scalarXml),
    data = new mt.MjData(model);
  try {
    configureModuleThreads(mt as unknown as MujocoModule, 2);
    initializeDataThreads(mt as unknown as MujocoModule, data as unknown as MujocoData);
    mt.mj_step(model, data);
    assert.ok(data.time > 0);
  } finally {
    data.delete();
    model.delete();
  }
});

test('3D flex uses only boundary triangles and 1D flex uses line elements', () => {
  for (const dim of [1, 3]) {
    const { model, close } = fixture(
      `<mujoco><worldbody><flexcomp name="f" type="grid" count="${dim === 1 ? '4 1 1' : '2 2 2'}" spacing=".1 .1 .1" dim="${dim}" mass="1"><edge equality="true"/></flexcomp></worldbody></mujoco>`,
    );
    try {
      const topology = getFlexTopology(model, 0);
      assert.equal(topology.kind, dim === 1 ? 'lines' : 'mesh');
      assert.equal(
        topology.indices.length,
        dim === 1 ? 2 * model.flex_elemnum[0] : 3 * model.flex_shellnum[0],
      );
      assert.ok(
        topology.indices.length > 0 && topology.indices.every((i) => i >= 0 && i < model.flex_vertnum[0]),
      );
    } finally {
      close();
    }
  }
});
