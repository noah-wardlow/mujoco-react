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
import { MujocoData, MujocoModel, MujocoModule } from '../types';
import { GenericIK } from './GenericIK';
import {
  ActuatorInfo,
  BodyInfo,
  ContactInfo,
  GeomInfo,
  IKSolveFn,
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
  getName,
} from './SceneLoader';

// ---- Joint type names ----
const JOINT_TYPE_NAMES = ['free', 'ball', 'slide', 'hinge'];
// ---- Geom type names ----
const GEOM_TYPE_NAMES = ['plane', 'hfield', 'sphere', 'capsule', 'ellipsoid', 'cylinder', 'box', 'mesh'];
// ---- Sensor type names (subset — MuJoCo has many) ----
// Sensor type names matching mjtSensor enum in mujoco WASM (mujoco-js 0.0.7)
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

// ---- Internal context types ----

export interface MujocoSimContextValue {
  api: MujocoSimAPI;
  mjModelRef: React.RefObject<MujocoModel | null>;
  mjDataRef: React.RefObject<MujocoData | null>;
  mujocoRef: React.RefObject<MujocoModule>;
  configRef: React.RefObject<SceneConfig>;
  siteIdRef: React.RefObject<number>;
  gripperIdRef: React.RefObject<number>;
  ikEnabledRef: React.RefObject<boolean>;
  ikCalculatingRef: React.RefObject<boolean>;
  pausedRef: React.RefObject<boolean>;
  speedRef: React.RefObject<number>;
  substepsRef: React.RefObject<number>;
  ikTargetRef: React.RefObject<THREE.Group>;
  genericIkRef: React.RefObject<GenericIK>;
  ikSolveFnRef: React.RefObject<IKSolveFn>;
  firstIkEnableRef: React.RefObject<boolean>;
  gizmoAnimRef: React.RefObject<{
    active: boolean;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startRot: THREE.Quaternion;
    endRot: THREE.Quaternion;
    startTime: number;
    duration: number;
  }>;
  cameraAnimRef: React.RefObject<{
    active: boolean;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startRot: THREE.Quaternion;
    endRot: THREE.Quaternion;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    startTime: number;
    duration: number;
    resolve: (() => void) | null;
  }>;
  onSelectionRef: React.RefObject<
    ((bodyId: number, name: string) => void) | undefined
  >;
  beforeStepCallbacks: React.RefObject<Set<PhysicsStepCallback>>;
  afterStepCallbacks: React.RefObject<Set<PhysicsStepCallback>>;
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
  onReady?: (api: MujocoSimAPI) => void;
  onError?: (error: Error) => void;
  onStep?: (time: number) => void;
  onSelection?: (bodyId: number, name: string) => void;
  // Declarative physics config props (spec 1.1)
  gravity?: [number, number, number];
  timestep?: number;
  substeps?: number;
  paused?: boolean;
  speed?: number;
  interpolate?: boolean;
  children: React.ReactNode;
}

export function MujocoSimProvider({
  mujoco,
  config,
  onReady,
  onError,
  onStep,
  onSelection,
  gravity,
  timestep,
  substeps,
  paused,
  speed,
  interpolate,
  children,
}: MujocoSimProviderProps) {
  const { gl, camera } = useThree();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // --- Refs ---
  const mjModelRef = useRef<MujocoModel | null>(null);
  const mjDataRef = useRef<MujocoData | null>(null);
  const mujocoRef = useRef<MujocoModule>(mujoco);
  const configRef = useRef<SceneConfig>(config);
  const siteIdRef = useRef(-1);
  const gripperIdRef = useRef(-1);
  const ikEnabledRef = useRef(false);
  const ikCalculatingRef = useRef(false);
  const pausedRef = useRef(paused ?? false);
  const speedRef = useRef(speed ?? 1);
  const substepsRef = useRef(substeps ?? 1);
  const interpolateRef = useRef(interpolate ?? false);
  const firstIkEnableRef = useRef(true);
  const stepsToRunRef = useRef(0); // for single-step mode (spec 1.2)

  // Interpolation state (spec 11.1)
  const prevXposRef = useRef<Float64Array | null>(null);
  const prevXquatRef = useRef<Float64Array | null>(null);
  const interpAlphaRef = useRef(0);

  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const beforeStepCallbacks = useRef(new Set<PhysicsStepCallback>());
  const afterStepCallbacks = useRef(new Set<PhysicsStepCallback>());

  configRef.current = config;

  // Sync declarative props to refs
  useEffect(() => { pausedRef.current = paused ?? false; }, [paused]);
  useEffect(() => { speedRef.current = speed ?? 1; }, [speed]);
  useEffect(() => { substepsRef.current = substeps ?? 1; }, [substeps]);
  useEffect(() => { interpolateRef.current = interpolate ?? false; }, [interpolate]);

  // Sync gravity prop (spec 1.1)
  useEffect(() => {
    if (!gravity) return;
    const model = mjModelRef.current;
    if (!model?.opt?.gravity) return;
    model.opt.gravity[0] = gravity[0];
    model.opt.gravity[1] = gravity[1];
    model.opt.gravity[2] = gravity[2];
  }, [gravity]);

  // Sync timestep prop (spec 1.1)
  useEffect(() => {
    if (timestep === undefined) return;
    const model = mjModelRef.current;
    if (!model?.opt) return;
    model.opt.timestep = timestep;
  }, [timestep]);

  const ikTargetRef = useRef<THREE.Group>(new THREE.Group());
  const genericIkRef = useRef<GenericIK>(new GenericIK(mujoco));

  const gizmoAnimRef = useRef({
    active: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startRot: new THREE.Quaternion(),
    endRot: new THREE.Quaternion(),
    startTime: 0,
    duration: 1000,
  });

  const cameraAnimRef = useRef({
    active: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startRot: new THREE.Quaternion(),
    endRot: new THREE.Quaternion(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    startTime: 0,
    duration: 0,
    resolve: null as (() => void) | null,
  });

  const orbitTargetRef = useRef(new THREE.Vector3(0, 0, 0));

  // --- Helper: sync gizmo to actual MuJoCo site position ---
  const syncGizmoToSite = useCallback((data: MujocoData, siteId: number, target: THREE.Group) => {
    if (siteId === -1) return;
    const sitePos = data.site_xpos.subarray(siteId * 3, siteId * 3 + 3);
    const siteMat = data.site_xmat.subarray(siteId * 9, siteId * 9 + 9);
    target.position.set(sitePos[0], sitePos[1], sitePos[2]);
    const m = new THREE.Matrix4().set(
      siteMat[0], siteMat[1], siteMat[2], 0,
      siteMat[3], siteMat[4], siteMat[5], 0,
      siteMat[6], siteMat[7], siteMat[8], 0,
      0, 0, 0, 1
    );
    target.quaternion.setFromRotationMatrix(m);
  }, []);

  // IK solve function
  const ikSolveFn = useCallback(
    (pos: THREE.Vector3, quat: THREE.Quaternion, currentQ: number[]): number[] | null => {
      const model = mjModelRef.current;
      const data = mjDataRef.current;
      if (!model || !data || siteIdRef.current === -1) return null;
      return genericIkRef.current.solve(
        model, data, siteIdRef.current,
        configRef.current.numArmJoints ?? 7,
        pos, quat, currentQ
      );
    },
    []
  );
  const ikSolveFnRef = useRef<IKSolveFn>(ikSolveFn);
  ikSolveFnRef.current = ikSolveFn;

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
        siteIdRef.current = result.siteId;
        gripperIdRef.current = result.gripperId;

        // Apply declarative physics props after load
        if (gravity && result.mjModel.opt?.gravity) {
          result.mjModel.opt.gravity[0] = gravity[0];
          result.mjModel.opt.gravity[1] = gravity[1];
          result.mjModel.opt.gravity[2] = gravity[2];
        }
        if (timestep !== undefined && result.mjModel.opt) {
          result.mjModel.opt.timestep = timestep;
        }

        if (ikTargetRef.current) {
          syncGizmoToSite(result.mjData, result.siteId, ikTargetRef.current);
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

  // Fire onReady when status changes to ready
  useEffect(() => {
    if (status === 'ready' && onReady) {
      onReady(apiRef.current);
    }
  }, [status]);

  // --- Physics step (priority -1) ---
  useFrame((state) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    // Gizmo animation
    const ga = gizmoAnimRef.current;
    const target = ikTargetRef.current;
    if (ga.active && target) {
      const now = performance.now();
      const elapsed = now - ga.startTime;
      const t = Math.min(elapsed / ga.duration, 1.0);
      const ease = 1 - Math.pow(1 - t, 3);
      target.position.lerpVectors(ga.startPos, ga.endPos, ease);
      target.quaternion.slerpQuaternions(ga.startRot, ga.endRot, ease);
      if (t >= 1.0) ga.active = false;
    }

    // Camera animation
    const ca = cameraAnimRef.current;
    if (ca.active) {
      const now = performance.now();
      const progress = Math.min((now - ca.startTime) / ca.duration, 1.0);
      const ease =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      camera.position.lerpVectors(ca.startPos, ca.endPos, ease);
      camera.quaternion.slerpQuaternions(ca.startRot, ca.endRot, ease);
      orbitTargetRef.current.lerpVectors(ca.startTarget, ca.endTarget, ease);
      const orbitControls = state.controls as { target?: THREE.Vector3 };
      if (orbitControls?.target) {
        orbitControls.target.copy(orbitTargetRef.current);
      }
      if (progress >= 1.0) {
        ca.active = false;
        camera.position.copy(ca.endPos);
        camera.quaternion.copy(ca.endRot);
        orbitTargetRef.current.copy(ca.endTarget);
        ca.resolve?.();
        ca.resolve = null;
      }
    }

    // Check single-step mode (spec 1.2)
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

    // IK
    if (ikEnabledRef.current && target) {
      ikCalculatingRef.current = true;
      const numArm = configRef.current.numArmJoints ?? 7;
      const currentQ: number[] = [];
      for (let i = 0; i < numArm; i++) currentQ.push(data.qpos[i]);
      const solution = ikSolveFnRef.current(target.position, target.quaternion, currentQ);
      if (solution) {
        for (let i = 0; i < numArm; i++) data.ctrl[i] = solution[i];
      }
    } else {
      ikCalculatingRef.current = false;
    }

    // Step physics with substeps (spec 1.1)
    const numSubsteps = substepsRef.current;
    if (stepsToRunRef.current > 0) {
      // Single-step mode (spec 1.2)
      for (let s = 0; s < stepsToRunRef.current; s++) {
        mujoco.mj_step(model, data);
      }
      stepsToRunRef.current = 0;
    } else {
      const startSimTime = data.time;
      const frameTime = (1.0 / 60.0) * speedRef.current;
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

    gizmoAnimRef.current.active = false;
    mujoco.mj_resetData(model, data);

    const homeJoints = configRef.current.homeJoints;
    if (homeJoints) {
      for (let i = 0; i < homeJoints.length; i++) {
        data.ctrl[i] = homeJoints[i];
        if (model.actuator_trnid[2 * i + 1] === 1) {
          const jointId = model.actuator_trnid[2 * i];
          if (jointId >= 0 && jointId < model.njnt) {
            const qposAdr = model.jnt_qposadr[jointId];
            data.qpos[qposAdr] = homeJoints[i];
          }
        }
      }
    }

    configRef.current.onReset?.(model, data);
    mujoco.mj_forward(model, data);

    if (ikTargetRef.current) {
      syncGizmoToSite(data, siteIdRef.current, ikTargetRef.current);
    }
    firstIkEnableRef.current = true;
    ikEnabledRef.current = false;
  }, [mujoco, syncGizmoToSite]);

  const setIkEnabled = useCallback((enabled: boolean) => {
    ikEnabledRef.current = enabled;
    const data = mjDataRef.current;
    if (enabled && data && !gizmoAnimRef.current.active && ikTargetRef.current) {
      syncGizmoToSite(data, siteIdRef.current, ikTargetRef.current);
      firstIkEnableRef.current = false;
    }
  }, [syncGizmoToSite]);

  const syncTargetToSite = useCallback(() => {
    const data = mjDataRef.current;
    const target = ikTargetRef.current;
    if (data && target) syncGizmoToSite(data, siteIdRef.current, target);
  }, [syncGizmoToSite]);

  const solveIK = useCallback(
    (pos: THREE.Vector3, quat: THREE.Quaternion, currentQ: number[]): number[] | null => {
      return ikSolveFnRef.current(pos, quat, currentQ);
    },
    []
  );

  const moveTarget = useCallback(
    (pos: THREE.Vector3, duration = 0) => {
      if (!ikEnabledRef.current) setIkEnabled(true);
      const target = ikTargetRef.current;
      if (!target) return;

      const targetPos = pos.clone();
      const targetRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));

      if (duration > 0) {
        const ga = gizmoAnimRef.current;
        ga.active = true;
        ga.startPos.copy(target.position);
        ga.endPos.copy(targetPos);
        ga.startRot.copy(target.quaternion);
        ga.endRot.copy(targetRot);
        ga.startTime = performance.now();
        ga.duration = duration;
      } else {
        gizmoAnimRef.current.active = false;
        target.position.copy(targetPos);
        target.quaternion.copy(targetRot);
      }
    },
    [setIkEnabled]
  );

  const setSpeed = useCallback((multiplier: number) => {
    speedRef.current = multiplier;
  }, []);

  const togglePause = useCallback((): boolean => {
    pausedRef.current = !pausedRef.current;
    return pausedRef.current;
  }, []);

  // spec 1.1: declarative pause
  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
  }, []);

  // spec 1.2: single-step mode
  const step = useCallback((n = 1) => {
    stepsToRunRef.current = n;
  }, []);

  // spec 1.3: simulation time access
  const getTime = useCallback((): number => {
    return mjDataRef.current?.time ?? 0;
  }, []);

  const getTimestep = useCallback((): number => {
    return mjModelRef.current?.opt?.timestep ?? 0.002;
  }, []);

  // spec 4.1: state snapshot save/restore
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

  // spec 4.3: qpos/qvel direct set/get
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

  // spec 3.1: ctrl set/get
  const setCtrl = useCallback((nameOrValues: string | Record<string, number>, value?: number) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    if (typeof nameOrValues === 'string') {
      // Single actuator by name
      const id = findActuatorByName(model, nameOrValues);
      if (id >= 0 && value !== undefined) data.ctrl[id] = value;
    } else {
      // Batch: { name: value, ... }
      for (const [name, val] of Object.entries(nameOrValues)) {
        const id = findActuatorByName(model, name);
        if (id >= 0) data.ctrl[id] = val;
      }
    }
  }, []);

  const getCtrl = useCallback((): Float64Array => {
    return mjDataRef.current ? new Float64Array(mjDataRef.current.ctrl) : new Float64Array(0);
  }, []);

  // spec 8.1: force/torque API
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

  // spec 2.1: sensor data
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

  // spec 2.4: contacts
  const getContacts = useCallback((): ContactInfo[] => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return [];
    const contacts: ContactInfo[] = [];
    const ncon = data.ncon;
    for (let i = 0; i < ncon; i++) {
      try {
        const c = (data.contact as { get(i: number): { geom1: number; geom2: number; pos: Float64Array; dist: number } }).get(i);
        contacts.push({
          geom1: c.geom1,
          geom1Name: getName(model, model.name_geomadr[c.geom1]),
          geom2: c.geom2,
          geom2Name: getName(model, model.name_geomadr[c.geom2]),
          pos: [c.pos[0], c.pos[1], c.pos[2]],
          depth: c.dist,
        });
      } catch {
        break; // WASM contact access can fail
      }
    }
    return contacts;
  }, []);

  // spec 5.1: model introspection
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

  // spec 5.3: model options
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

  // spec 7.1: physics raycast
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
      return null; // mj_ray may not be available in all WASM builds
    }
  }, [mujoco]);

  // spec 4.2: keyframe improvements
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

    // Also restore qvel if available (spec 4.2)
    if (model.key_qvel) {
      const qvelOffset = keyId * model.nv;
      for (let i = 0; i < model.nv; i++) data.qvel[i] = model.key_qvel[qvelOffset + i];
    }

    mujoco.mj_forward(model, data);

    if (ikTargetRef.current) {
      syncGizmoToSite(data, siteIdRef.current, ikTargetRef.current);
    }
  }, [mujoco, syncGizmoToSite]);

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

  // spec 9.1: runtime model swap
  const loadSceneApi = useCallback(async (newConfig: SceneConfig): Promise<void> => {
    try {
      // Clean up current model
      mjModelRef.current?.delete();
      mjDataRef.current?.delete();
      mjModelRef.current = null;
      mjDataRef.current = null;
      setStatus('loading');

      const result = await loadScene(mujoco, newConfig);
      mjModelRef.current = result.mjModel;
      mjDataRef.current = result.mjData;
      siteIdRef.current = result.siteId;
      gripperIdRef.current = result.gripperId;
      configRef.current = newConfig;

      if (ikTargetRef.current) {
        syncGizmoToSite(result.mjData, result.siteId, ikTargetRef.current);
      }
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      throw e;
    }
  }, [mujoco, syncGizmoToSite]);

  const getGizmoStats = useCallback((): { pos: THREE.Vector3; rot: THREE.Euler } | null => {
    const target = ikTargetRef.current;
    if (!ikCalculatingRef.current || !target) return null;
    return {
      pos: target.position.clone(),
      rot: new THREE.Euler().setFromQuaternion(target.quaternion),
    };
  }, []);

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
      const ndc = new THREE.Vector2(x * 2 - 1, -(y * 2 - 1));
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, virtCam);
      const objects: THREE.Object3D[] = [];
      const scene = (camera as THREE.PerspectiveCamera).parent;
      if (scene) {
        scene.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) objects.push(c);
        });
      }
      const hits = raycaster.intersectObjects(objects);
      if (hits.length > 0) {
        const hitObj = hits[0].object;
        // Find geomId from the hit object's userData
        const geomId = hitObj.userData.geomID !== undefined ? hitObj.userData.geomID : -1;
        // Walk up to find bodyId
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

  // --- Domain randomization (spec 10.3) ---

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

  const getCameraState = useCallback((): { position: THREE.Vector3; target: THREE.Vector3 } => {
    return { position: camera.position.clone(), target: orbitTargetRef.current.clone() };
  }, [camera]);

  const moveCameraTo = useCallback(
    (position: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> => {
      return new Promise((resolve) => {
        const ca = cameraAnimRef.current;
        ca.active = true;
        ca.startTime = performance.now();
        ca.duration = durationMs;
        ca.startPos.copy(camera.position);
        ca.startRot.copy(camera.quaternion);
        ca.startTarget.copy(orbitTargetRef.current);
        ca.endPos.copy(position);
        ca.endTarget.copy(target);
        const dummyCam = (camera as THREE.PerspectiveCamera).clone();
        dummyCam.position.copy(position);
        dummyCam.lookAt(target);
        ca.endRot.copy(dummyCam.quaternion);
        ca.resolve = resolve;
        setTimeout(resolve, durationMs + 100);
      });
    },
    [camera]
  );

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
      setIkEnabled,
      moveTarget,
      syncTargetToSite,
      solveIK,
      getGizmoStats,
      getCanvasSnapshot,
      project2DTo3D,
      getCameraState,
      moveCameraTo,
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
      setIkEnabled, moveTarget, syncTargetToSite, solveIK, getGizmoStats,
      getCanvasSnapshot, project2DTo3D, getCameraState, moveCameraTo,
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
      siteIdRef,
      gripperIdRef,
      ikEnabledRef,
      ikCalculatingRef,
      pausedRef,
      speedRef,
      substepsRef,
      ikTargetRef,
      genericIkRef,
      ikSolveFnRef,
      firstIkEnableRef,
      gizmoAnimRef,
      cameraAnimRef,
      onSelectionRef,
      beforeStepCallbacks,
      afterStepCallbacks,
      status,
    }),
    [api, status]
  );

  return (
    <MujocoSimContext.Provider value={contextValue}>
      {children}
    </MujocoSimContext.Provider>
  );
}
