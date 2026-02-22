/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { MujocoData, MujocoModel, MujocoModule, getContact } from '../types';
import { SceneRenderer } from '../components/SceneRenderer';
import {
  ActuatorInfo,
  BodyInfo,
  ContactInfo,
  GeomInfo,
  JointInfo,
  ModelOptions,
  MujocoSimAPI,
  PhysicsStepCallback,
  RayHit,
  SceneConfig,
  SensorInfo,
  SiteInfo,
  StateSnapshot,
} from '../types';
import {
  loadScene,
  findKeyframeByName,
  findBodyByName,
  findGeomByName,
  findSensorByName,
  findActuatorByName,
  getActuatedScalarQposAdr,
  getName,
} from './SceneLoader';

// ---- Joint type names ----
const JOINT_TYPE_NAMES = ['free', 'ball', 'slide', 'hinge'];
// ---- Geom type names ----
const GEOM_TYPE_NAMES = ['plane', 'hfield', 'sphere', 'capsule', 'ellipsoid', 'cylinder', 'box', 'mesh'];
// ---- Sensor type names (subset — MuJoCo has many) ----
const SENSOR_TYPE_NAMES: Record<number, string> = {
  0: 'touch', 1: 'accelerometer', 2: 'velocimeter', 3: 'gyro',
  4: 'force', 5: 'torque', 6: 'magnetometer', 7: 'rangefinder',
  8: 'camprojection', 9: 'jointpos', 10: 'jointvel', 11: 'tendonpos',
  12: 'tendonvel', 13: 'actuatorpos', 14: 'actuatorvel', 15: 'actuatorfrc',
  16: 'jointactfrc', 17: 'tendonactfrc', 18: 'ballquat', 19: 'ballangvel',
  20: 'jointlimitpos', 21: 'jointlimitvel', 22: 'jointlimitfrc',
  23: 'tendonlimitpos', 24: 'tendonlimitvel', 25: 'tendonlimitfrc',
  26: 'framepos', 27: 'framequat', 28: 'framexaxis', 29: 'frameyaxis',
  30: 'framezaxis', 31: 'framelinvel', 32: 'frameangvel',
  33: 'framelinacc', 34: 'frameangacc', 35: 'subtreecom',
  36: 'subtreelinvel', 37: 'subtreeangmom', 38: 'insidesite',
  39: 'geomdist', 40: 'geomnormal', 41: 'geomfromto',
  42: 'contact', 43: 'e_potential', 44: 'e_kinetic',
  45: 'clock', 46: 'tactile', 47: 'plugin', 48: 'user',
};

// Preallocated force/torque temps for applyForce/applyTorque
const _applyForce = new Float64Array(3);
const _applyTorque = new Float64Array(3);
const _applyPoint = new Float64Array(3);
const _rayPnt = new Float64Array(3);
const _rayVec = new Float64Array(3);
const _rayGeomId = new Int32Array(1);
const _projRaycaster = new THREE.Raycaster();
const _projNdc = new THREE.Vector2();

// ---- Internal context types ----

export interface MujocoSimContextValue {
  api: MujocoSimAPI;
  mjModelRef: React.RefObject<MujocoModel | null>;
  mjDataRef: React.RefObject<MujocoData | null>;
  mujocoRef: React.RefObject<MujocoModule>;
  configRef: React.RefObject<SceneConfig>;
  pausedRef: React.RefObject<boolean>;
  speedRef: React.RefObject<number>;
  substepsRef: React.RefObject<number>;
  onSelectionRef: React.RefObject<
    ((bodyId: number, name: string) => void) | undefined
  >;
  beforeStepCallbacks: React.RefObject<Set<PhysicsStepCallback>>;
  afterStepCallbacks: React.RefObject<Set<PhysicsStepCallback>>;
  resetCallbacks: React.RefObject<Set<() => void>>;
  status: 'loading' | 'ready' | 'error';
}

const MujocoSimContext = createContext<MujocoSimContextValue | null>(null);

export function useMujocoSim(): MujocoSimContextValue {
  const ctx = useContext(MujocoSimContext);
  if (!ctx)
    throw new Error('useMujocoSim must be used inside <MujocoSimProvider>');
  return ctx;
}

export function useBeforePhysicsStep(callback: PhysicsStepCallback) {
  const { beforeStepCallbacks } = useMujocoSim();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const wrapped: PhysicsStepCallback = (model, data) => callbackRef.current(model, data);
    beforeStepCallbacks.current.add(wrapped);
    return () => { beforeStepCallbacks.current.delete(wrapped); };
  }, [beforeStepCallbacks]);
}

export function useAfterPhysicsStep(callback: PhysicsStepCallback) {
  const { afterStepCallbacks } = useMujocoSim();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const wrapped: PhysicsStepCallback = (model, data) => callbackRef.current(model, data);
    afterStepCallbacks.current.add(wrapped);
    return () => { afterStepCallbacks.current.delete(wrapped); };
  }, [afterStepCallbacks]);
}

interface MujocoSimProviderProps {
  mujoco: MujocoModule;
  config: SceneConfig;
  apiRef?: React.ForwardedRef<MujocoSimAPI>;
  onReady?: (api: MujocoSimAPI) => void;
  onError?: (error: Error) => void;
  onStep?: (time: number) => void;
  onSelection?: (bodyId: number, name: string) => void;
  // Declarative physics config props
  gravity?: [number, number, number];
  timestep?: number;
  substeps?: number;
  paused?: boolean;
  speed?: number;
  children: React.ReactNode;
}

export function MujocoSimProvider({
  mujoco,
  config,
  apiRef: externalApiRef,
  onReady,
  onError,
  onStep,
  onSelection,
  gravity,
  timestep,
  substeps,
  paused,
  speed,
  children,
}: MujocoSimProviderProps) {
  const { gl, camera } = useThree();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // --- Refs ---
  const mjModelRef = useRef<MujocoModel | null>(null);
  const mjDataRef = useRef<MujocoData | null>(null);
  const mujocoRef = useRef<MujocoModule>(mujoco);
  const configRef = useRef<SceneConfig>(config);
  const pausedRef = useRef(paused ?? false);
  const speedRef = useRef(speed ?? 1);
  const substepsRef = useRef(substeps ?? 1);
  const stepsToRunRef = useRef(0);
  const loadGenRef = useRef(0);

  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const beforeStepCallbacks = useRef(new Set<PhysicsStepCallback>());
  const afterStepCallbacks = useRef(new Set<PhysicsStepCallback>());
  const resetCallbacks = useRef(new Set<() => void>());

  configRef.current = config;

  // Sync declarative props to refs
  useEffect(() => { pausedRef.current = paused ?? false; }, [paused]);
  useEffect(() => { speedRef.current = speed ?? 1; }, [speed]);
  useEffect(() => { substepsRef.current = substeps ?? 1; }, [substeps]);

  // Sync gravity prop
  useEffect(() => {
    if (!gravity) return;
    const model = mjModelRef.current;
    if (!model?.opt?.gravity) return;
    model.opt.gravity[0] = gravity[0];
    model.opt.gravity[1] = gravity[1];
    model.opt.gravity[2] = gravity[2];
  }, [gravity]);

  // Sync timestep prop
  useEffect(() => {
    if (timestep === undefined) return;
    const model = mjModelRef.current;
    if (!model?.opt) return;
    model.opt.timestep = timestep;
  }, [timestep]);

  // --- Load scene on mount ---
  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const result = await loadScene(mujoco, config);
        if (disposed) {
          result.mjModel.delete();
          result.mjData.delete();
          return;
        }

        mjModelRef.current = result.mjModel;
        mjDataRef.current = result.mjData;

        // Apply declarative physics props after load
        if (gravity && result.mjModel.opt?.gravity) {
          result.mjModel.opt.gravity[0] = gravity[0];
          result.mjModel.opt.gravity[1] = gravity[1];
          result.mjModel.opt.gravity[2] = gravity[2];
        }
        if (timestep !== undefined && result.mjModel.opt) {
          result.mjModel.opt.timestep = timestep;
        }

        setStatus('ready');
      } catch (e: unknown) {
        if (!disposed) {
          setStatus('error');
          onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      }
    })();

    return () => {
      disposed = true;
      mjModelRef.current?.delete();
      mjDataRef.current?.delete();
      mjModelRef.current = null;
      mjDataRef.current = null;
      try { mujoco.FS.unmount('/working'); } catch { /* ignore */ }
    };
  }, [mujoco, config]);

  // Fire onReady and assign external ref when status changes to ready
  useEffect(() => {
    if (status === 'ready') {
      const api = apiRef.current;
      if (onReady) onReady(api);
      // Assign the forwarded ref
      if (externalApiRef) {
        if (typeof externalApiRef === 'function') {
          externalApiRef(api);
        } else {
          (externalApiRef as React.MutableRefObject<MujocoSimAPI | null>).current = api;
        }
      }
    }
  }, [status]);

  // --- Physics step (priority -1) ---
  useFrame((_state, delta) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    // Check single-step mode
    const shouldStep = !pausedRef.current || stepsToRunRef.current > 0;
    if (!shouldStep) return;

    // Zero generalized applied forces
    for (let i = 0; i < model.nv; i++) {
      data.qfrc_applied[i] = 0;
    }

    // Before-step callbacks
    for (const cb of beforeStepCallbacks.current) {
      cb(model, data);
    }

    // Step physics with substeps
    const numSubsteps = substepsRef.current;
    if (stepsToRunRef.current > 0) {
      for (let s = 0; s < stepsToRunRef.current; s++) {
        mujoco.mj_step(model, data);
      }
      stepsToRunRef.current = 0;
    } else {
      const startSimTime = data.time;
      const clampedDelta = Math.min(delta, 1 / 15); // cap to avoid spiral of death
      const frameTime = clampedDelta * speedRef.current;
      while (data.time - startSimTime < frameTime) {
        for (let s = 0; s < numSubsteps; s++) {
          mujoco.mj_step(model, data);
        }
      }
    }

    // After-step callbacks
    for (const cb of afterStepCallbacks.current) {
      cb(model, data);
    }

    onStepRef.current?.(data.time);
  }, -1);

  // --- API Methods ---

  const reset = useCallback(() => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    mujoco.mj_resetData(model, data);

    const homeJoints = configRef.current.homeJoints;
    if (homeJoints) {
      const homeCount = Math.min(homeJoints.length, model.nu);
      for (let i = 0; i < homeCount; i++) {
        data.ctrl[i] = homeJoints[i];
        const qposAdr = getActuatedScalarQposAdr(model, i);
        if (qposAdr !== -1) {
          data.qpos[qposAdr] = homeJoints[i];
        }
      }
    }

    configRef.current.onReset?.(model, data);
    mujoco.mj_forward(model, data);

    // Notify composable plugins (e.g. IkController)
    for (const cb of resetCallbacks.current) {
      cb();
    }
  }, [mujoco]);

  const setSpeed = useCallback((multiplier: number) => {
    speedRef.current = multiplier;
  }, []);

  const togglePause = useCallback((): boolean => {
    pausedRef.current = !pausedRef.current;
    return pausedRef.current;
  }, []);

  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
  }, []);

  const step = useCallback((n = 1) => {
    stepsToRunRef.current = n;
  }, []);

  const getTime = useCallback((): number => {
    return mjDataRef.current?.time ?? 0;
  }, []);

  const getTimestep = useCallback((): number => {
    return mjModelRef.current?.opt?.timestep ?? 0.002;
  }, []);

  const saveState = useCallback((): StateSnapshot => {
    const data = mjDataRef.current;
    if (!data) return { time: 0, qpos: new Float64Array(0), qvel: new Float64Array(0), ctrl: new Float64Array(0), act: new Float64Array(0), qfrc_applied: new Float64Array(0) };
    return {
      time: data.time,
      qpos: new Float64Array(data.qpos),
      qvel: new Float64Array(data.qvel),
      ctrl: new Float64Array(data.ctrl),
      act: new Float64Array(data.act),
      qfrc_applied: new Float64Array(data.qfrc_applied),
    };
  }, []);

  const restoreState = useCallback((snapshot: StateSnapshot) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;
    data.time = snapshot.time;
    data.qpos.set(snapshot.qpos);
    data.qvel.set(snapshot.qvel);
    data.ctrl.set(snapshot.ctrl);
    if (snapshot.act.length > 0) data.act.set(snapshot.act);
    data.qfrc_applied.set(snapshot.qfrc_applied);
    mujoco.mj_forward(model, data);
  }, [mujoco]);

  const setQpos = useCallback((values: Float64Array | number[]) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;
    const arr = values instanceof Float64Array ? values : new Float64Array(values);
    data.qpos.set(arr.subarray(0, Math.min(arr.length, model.nq)));
    mujoco.mj_forward(model, data);
  }, [mujoco]);

  const setQvel = useCallback((values: Float64Array | number[]) => {
    const data = mjDataRef.current;
    if (!data) return;
    const arr = values instanceof Float64Array ? values : new Float64Array(values);
    data.qvel.set(arr.subarray(0, Math.min(arr.length, mjModelRef.current?.nv ?? 0)));
  }, []);

  const getQpos = useCallback((): Float64Array => {
    return mjDataRef.current ? new Float64Array(mjDataRef.current.qpos) : new Float64Array(0);
  }, []);

  const getQvel = useCallback((): Float64Array => {
    return mjDataRef.current ? new Float64Array(mjDataRef.current.qvel) : new Float64Array(0);
  }, []);

  const setCtrl = useCallback((nameOrValues: string | Record<string, number>, value?: number) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    if (typeof nameOrValues === 'string') {
      const id = findActuatorByName(model, nameOrValues);
      if (id >= 0 && value !== undefined) data.ctrl[id] = value;
    } else {
      for (const [name, val] of Object.entries(nameOrValues)) {
        const id = findActuatorByName(model, name);
        if (id >= 0) data.ctrl[id] = val;
      }
    }
  }, []);

  const getCtrl = useCallback((): Float64Array => {
    return mjDataRef.current ? new Float64Array(mjDataRef.current.ctrl) : new Float64Array(0);
  }, []);

  const applyForce = useCallback((bodyName: string, force: THREE.Vector3, point?: THREE.Vector3) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;
    const bodyId = findBodyByName(model, bodyName);
    if (bodyId < 0) return;

    _applyForce[0] = force.x; _applyForce[1] = force.y; _applyForce[2] = force.z;
    _applyTorque[0] = 0; _applyTorque[1] = 0; _applyTorque[2] = 0;
    if (point) {
      _applyPoint[0] = point.x; _applyPoint[1] = point.y; _applyPoint[2] = point.z;
    } else {
      const i3 = bodyId * 3;
      _applyPoint[0] = data.xpos[i3]; _applyPoint[1] = data.xpos[i3 + 1]; _applyPoint[2] = data.xpos[i3 + 2];
    }
    mujoco.mj_applyFT(model, data, _applyForce, _applyTorque, _applyPoint, bodyId, data.qfrc_applied);
  }, [mujoco]);

  const applyTorqueApi = useCallback((bodyName: string, torque: THREE.Vector3) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;
    const bodyId = findBodyByName(model, bodyName);
    if (bodyId < 0) return;

    _applyForce[0] = 0; _applyForce[1] = 0; _applyForce[2] = 0;
    _applyTorque[0] = torque.x; _applyTorque[1] = torque.y; _applyTorque[2] = torque.z;
    const i3 = bodyId * 3;
    _applyPoint[0] = data.xpos[i3]; _applyPoint[1] = data.xpos[i3 + 1]; _applyPoint[2] = data.xpos[i3 + 2];
    mujoco.mj_applyFT(model, data, _applyForce, _applyTorque, _applyPoint, bodyId, data.qfrc_applied);
  }, [mujoco]);

  const setExternalForce = useCallback((bodyName: string, force: THREE.Vector3, torque: THREE.Vector3) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;
    const bodyId = findBodyByName(model, bodyName);
    if (bodyId < 0) return;
    const i6 = bodyId * 6;
    data.xfrc_applied[i6] = torque.x; data.xfrc_applied[i6 + 1] = torque.y; data.xfrc_applied[i6 + 2] = torque.z;
    data.xfrc_applied[i6 + 3] = force.x; data.xfrc_applied[i6 + 4] = force.y; data.xfrc_applied[i6 + 5] = force.z;
  }, []);

  const applyGeneralizedForce = useCallback((values: Float64Array | number[]) => {
    const data = mjDataRef.current;
    if (!data) return;
    const nv = mjModelRef.current?.nv ?? 0;
    for (let i = 0; i < Math.min(values.length, nv); i++) {
      data.qfrc_applied[i] += values[i];
    }
  }, []);

  const getSensorData = useCallback((name: string): Float64Array | null => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return null;
    const id = findSensorByName(model, name);
    if (id < 0) return null;
    const adr = model.sensor_adr[id];
    const dim = model.sensor_dim[id];
    return new Float64Array(data.sensordata.subarray(adr, adr + dim));
  }, []);

  const getContacts = useCallback((): ContactInfo[] => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return [];
    const contacts: ContactInfo[] = [];
    const ncon = data.ncon;
    for (let i = 0; i < ncon; i++) {
      const c = getContact(data, i);
      if (!c) break;
      contacts.push({
        geom1: c.geom1,
        geom1Name: getName(model, model.name_geomadr[c.geom1]),
        geom2: c.geom2,
        geom2Name: getName(model, model.name_geomadr[c.geom2]),
        pos: [c.pos[0], c.pos[1], c.pos[2]],
        depth: c.dist,
      });
    }
    return contacts;
  }, []);

  const getBodies = useCallback((): BodyInfo[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const result: BodyInfo[] = [];
    for (let i = 0; i < model.nbody; i++) {
      result.push({
        id: i,
        name: getName(model, model.name_bodyadr[i]),
        mass: model.body_mass[i],
        parentId: model.body_parentid[i],
      });
    }
    return result;
  }, []);

  const getJoints = useCallback((): JointInfo[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const result: JointInfo[] = [];
    for (let i = 0; i < model.njnt; i++) {
      const type = model.jnt_type[i];
      const limited = model.jnt_limited ? model.jnt_limited[i] !== 0 : false;
      result.push({
        id: i,
        name: getName(model, model.name_jntadr[i]),
        type,
        typeName: JOINT_TYPE_NAMES[type] ?? `unknown(${type})`,
        range: [model.jnt_range[2 * i], model.jnt_range[2 * i + 1]],
        limited,
        bodyId: model.jnt_bodyid[i],
        qposAdr: model.jnt_qposadr[i],
        dofAdr: model.jnt_dofadr[i],
      });
    }
    return result;
  }, []);

  const getGeoms = useCallback((): GeomInfo[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const result: GeomInfo[] = [];
    for (let i = 0; i < model.ngeom; i++) {
      const type = model.geom_type[i];
      result.push({
        id: i,
        name: getName(model, model.name_geomadr[i]),
        type,
        typeName: GEOM_TYPE_NAMES[type] ?? `unknown(${type})`,
        size: [model.geom_size[3 * i], model.geom_size[3 * i + 1], model.geom_size[3 * i + 2]],
        bodyId: model.geom_bodyid[i],
      });
    }
    return result;
  }, []);

  const getSites = useCallback((): SiteInfo[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const result: SiteInfo[] = [];
    for (let i = 0; i < model.nsite; i++) {
      result.push({
        id: i,
        name: getName(model, model.name_siteadr[i]),
        bodyId: model.site_bodyid ? model.site_bodyid[i] : -1,
      });
    }
    return result;
  }, []);

  const getActuatorsApi = useCallback((): ActuatorInfo[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const result: ActuatorInfo[] = [];
    for (let i = 0; i < model.nu; i++) {
      const hasRange = model.actuator_ctrlrange[2 * i] < model.actuator_ctrlrange[2 * i + 1];
      result.push({
        id: i,
        name: getName(model, model.name_actuatoradr[i]),
        range: hasRange
          ? [model.actuator_ctrlrange[2 * i], model.actuator_ctrlrange[2 * i + 1]]
          : [-Infinity, Infinity],
      });
    }
    return result;
  }, []);

  const getSensors = useCallback((): SensorInfo[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const result: SensorInfo[] = [];
    for (let i = 0; i < model.nsensor; i++) {
      const type = model.sensor_type[i];
      result.push({
        id: i,
        name: getName(model, model.name_sensoradr[i]),
        type,
        typeName: SENSOR_TYPE_NAMES[type] ?? `unknown(${type})`,
        dim: model.sensor_dim[i],
        adr: model.sensor_adr[i],
      });
    }
    return result;
  }, []);

  const getModelOption = useCallback((): ModelOptions => {
    const model = mjModelRef.current;
    if (!model?.opt) return { timestep: 0.002, gravity: [0, 0, -9.81], integrator: 0 };
    return {
      timestep: model.opt.timestep,
      gravity: [model.opt.gravity[0], model.opt.gravity[1], model.opt.gravity[2]],
      integrator: model.opt.integrator,
    };
  }, []);

  const setGravity = useCallback((g: [number, number, number]) => {
    const model = mjModelRef.current;
    if (!model?.opt?.gravity) return;
    model.opt.gravity[0] = g[0];
    model.opt.gravity[1] = g[1];
    model.opt.gravity[2] = g[2];
  }, []);

  const setTimestepApi = useCallback((dt: number) => {
    const model = mjModelRef.current;
    if (!model?.opt) return;
    model.opt.timestep = dt;
  }, []);

  const raycast = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, maxDist = 100): RayHit | null => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return null;

    _rayPnt[0] = origin.x; _rayPnt[1] = origin.y; _rayPnt[2] = origin.z;
    const dir = direction.clone().normalize();
    _rayVec[0] = dir.x; _rayVec[1] = dir.y; _rayVec[2] = dir.z;
    _rayGeomId[0] = -1;

    try {
      const dist = mujoco.mj_ray(model, data, _rayPnt, _rayVec, null, 1, -1, _rayGeomId);
      if (dist < 0 || dist > maxDist) return null;
      const geomId = _rayGeomId[0];
      const bodyId = geomId >= 0 ? model.geom_bodyid[geomId] : -1;
      return {
        point: new THREE.Vector3(
          origin.x + dir.x * dist,
          origin.y + dir.y * dist,
          origin.z + dir.z * dist,
        ),
        bodyId,
        geomId,
        distance: dist,
      };
    } catch {
      return null;
    }
  }, [mujoco]);

  const applyKeyframe = useCallback((nameOrIndex: string | number) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    let keyId: number;
    if (typeof nameOrIndex === 'number') {
      keyId = nameOrIndex;
    } else {
      keyId = findKeyframeByName(model, nameOrIndex);
    }
    if (keyId < 0 || keyId >= model.nkey) {
      console.warn(`applyKeyframe: keyframe "${nameOrIndex}" not found`);
      return;
    }

    const nq = model.nq;
    const nu = model.nu;
    const qposOffset = keyId * nq;
    for (let i = 0; i < nq; i++) data.qpos[i] = model.key_qpos[qposOffset + i];
    const ctrlOffset = keyId * nu;
    for (let i = 0; i < nu; i++) data.ctrl[i] = model.key_ctrl[ctrlOffset + i];

    if (model.key_qvel) {
      const qvelOffset = keyId * model.nv;
      for (let i = 0; i < model.nv; i++) data.qvel[i] = model.key_qvel[qvelOffset + i];
    }

    mujoco.mj_forward(model, data);

    // Notify composable plugins
    for (const cb of resetCallbacks.current) {
      cb();
    }
  }, [mujoco]);

  const getKeyframeNames = useCallback((): string[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const names: string[] = [];
    for (let i = 0; i < model.nkey; i++) {
      names.push(getName(model, model.name_keyadr[i]));
    }
    return names;
  }, []);

  const getKeyframeCount = useCallback((): number => {
    return mjModelRef.current?.nkey ?? 0;
  }, []);

  const loadSceneApi = useCallback(async (newConfig: SceneConfig): Promise<void> => {
    const gen = ++loadGenRef.current;
    try {
      mjModelRef.current?.delete();
      mjDataRef.current?.delete();
      mjModelRef.current = null;
      mjDataRef.current = null;
      setStatus('loading');

      const result = await loadScene(mujoco, newConfig);

      if (gen !== loadGenRef.current) {
        result.mjModel.delete();
        result.mjData.delete();
        return;
      }

      mjModelRef.current = result.mjModel;
      mjDataRef.current = result.mjData;
      configRef.current = newConfig;

      setStatus('ready');
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setStatus('error');
      throw e;
    }
  }, [mujoco]);

  const getCanvasSnapshot = useCallback(
    (width?: number, height?: number, mimeType = 'image/jpeg'): string => {
      if (width && height) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(gl.domElement, 0, 0, width, height);
          return tempCanvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.8 : undefined);
        }
      }
      return gl.domElement.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.8 : undefined);
    },
    [gl]
  );

  const project2DTo3D = useCallback(
    (x: number, y: number, cameraPos: THREE.Vector3, lookAt: THREE.Vector3): { point: THREE.Vector3; bodyId: number; geomId: number } | null => {
      const virtCam = (camera as THREE.PerspectiveCamera).clone();
      virtCam.position.copy(cameraPos);
      virtCam.lookAt(lookAt);
      virtCam.updateMatrixWorld();
      virtCam.updateProjectionMatrix();
      _projNdc.set(x * 2 - 1, -(y * 2 - 1));
      _projRaycaster.setFromCamera(_projNdc, virtCam);
      const objects: THREE.Object3D[] = [];
      const scene = (camera as THREE.PerspectiveCamera).parent;
      if (scene) {
        scene.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) objects.push(c);
        });
      }
      const hits = _projRaycaster.intersectObjects(objects);
      if (hits.length > 0) {
        const hitObj = hits[0].object;
        const geomId = hitObj.userData.geomID !== undefined ? hitObj.userData.geomID : -1;
        let obj = hitObj;
        while (obj && obj.userData.bodyID === undefined && obj.parent) {
          obj = obj.parent;
        }
        const bodyId = obj && obj.userData.bodyID !== undefined ? obj.userData.bodyID : -1;
        return { point: hits[0].point, bodyId, geomId };
      }
      return null;
    },
    [camera, gl]
  );

  // --- Domain randomization ---

  const setBodyMass = useCallback((name: string, mass: number): void => {
    const model = mjModelRef.current;
    if (!model) return;
    const id = findBodyByName(model, name);
    if (id < 0) return;
    model.body_mass[id] = mass;
  }, []);

  const setGeomFriction = useCallback((name: string, friction: [number, number, number]): void => {
    const model = mjModelRef.current;
    if (!model) return;
    const id = findGeomByName(model, name);
    if (id < 0) return;
    model.geom_friction[id * 3] = friction[0];
    model.geom_friction[id * 3 + 1] = friction[1];
    model.geom_friction[id * 3 + 2] = friction[2];
  }, []);

  const setGeomSize = useCallback((name: string, size: [number, number, number]): void => {
    const model = mjModelRef.current;
    if (!model) return;
    const id = findGeomByName(model, name);
    if (id < 0) return;
    model.geom_size[id * 3] = size[0];
    model.geom_size[id * 3 + 1] = size[1];
    model.geom_size[id * 3 + 2] = size[2];
  }, []);

  // --- Assemble API ---
  const api = useMemo<MujocoSimAPI>(
    () => ({
      get status() { return status; },
      config,
      reset,
      setSpeed,
      togglePause,
      setPaused,
      step,
      getTime,
      getTimestep,
      applyKeyframe,
      saveState,
      restoreState,
      setQpos,
      setQvel,
      getQpos,
      getQvel,
      setCtrl,
      getCtrl,
      applyForce,
      applyTorque: applyTorqueApi,
      setExternalForce,
      applyGeneralizedForce,
      getSensorData,
      getContacts,
      getBodies,
      getJoints,
      getGeoms,
      getSites,
      getActuators: getActuatorsApi,
      getSensors,
      getModelOption,
      setGravity,
      setTimestep: setTimestepApi,
      raycast,
      getKeyframeNames,
      getKeyframeCount,
      loadScene: loadSceneApi,
      getCanvasSnapshot,
      project2DTo3D,
      setBodyMass,
      setGeomFriction,
      setGeomSize,
      mjModelRef,
      mjDataRef,
    }),
    [
      status, config, reset, setSpeed, togglePause, setPaused, step,
      getTime, getTimestep, applyKeyframe, saveState, restoreState,
      setQpos, setQvel, getQpos, getQvel, setCtrl, getCtrl,
      applyForce, applyTorqueApi, setExternalForce, applyGeneralizedForce,
      getSensorData, getContacts, getBodies, getJoints, getGeoms, getSites,
      getActuatorsApi, getSensors, getModelOption, setGravity, setTimestepApi,
      raycast, getKeyframeNames, getKeyframeCount, loadSceneApi,
      getCanvasSnapshot, project2DTo3D,
      setBodyMass, setGeomFriction, setGeomSize,
    ]
  );
  const apiRef = useRef(api);
  apiRef.current = api;

  const contextValue = useMemo<MujocoSimContextValue>(
    () => ({
      api,
      mjModelRef,
      mjDataRef,
      mujocoRef,
      configRef,
      pausedRef,
      speedRef,
      substepsRef,
      onSelectionRef,
      beforeStepCallbacks,
      afterStepCallbacks,
      resetCallbacks,
      status,
    }),
    [api, status]
  );

  return (
    <MujocoSimContext.Provider value={contextValue}>
      <SceneRenderer />
      {children}
    </MujocoSimContext.Provider>
  );
}
