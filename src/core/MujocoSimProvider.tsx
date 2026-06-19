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
import { MujocoData, MujocoModel, MujocoModule, getContact, withContacts } from '../types';
import { SceneRenderer } from '../components/SceneRenderer';
import {
  ActuatedJointInfo,
  ActuatorInfo,
  BodyInfo,
  CameraFrameCaptureOptions,
  CameraFrameCaptureResult,
  CameraFrameCaptureSource,
  CameraFrameSequenceFrame,
  CameraFrameSequenceOptions,
  CameraFrameSequenceResult,
  CameraInfo,
  ControlGroupInfo,
  ControlGroupSelector,
  ContactInfo,
  GeomInfo,
  JointInfo,
  LoadFromFilesOptions,
  LocalMujocoFile,
  ModelOptions,
  MujocoSimAPI,
  PhysicsStepCallback,
  RayHit,
  ReadyCallbackInput,
  SceneConfig,
  SceneObject,
  SelectionCallbackInput,
  SensorInfo,
  SiteInfo,
  StateSnapshot,
  StepCallbackInput,
  XmlPatch,
} from '../types';
import {
  captureFrame as captureCanvasFrame,
  captureFrameBlob as captureCanvasFrameBlob,
} from '../hooks/useFrameCapture';
import {
  captureCameraFrame,
  captureCameraFrameBlob,
  createCameraFrameCaptureSession,
} from '../rendering/cameraFrameCapture';
import {
  getCameraFrameCaptureSourceTarget,
  isMountedCameraFrameCaptureSource,
} from '../rendering/cameraFrameSource';
import {
  loadScene,
  createSceneConfigFromFiles,
  findKeyframeByName,
  findBodyByName,
  findSiteByName,
  findGeomByName,
  findSensorByName,
  findActuatorByName,
  findCameraByName,
  getActuatedScalarQposAdr,
  getActuatedJoints as getActuatedJointsFromModel,
  getControlMap as getControlMapFromModel,
  getName,
  resolveControlGroup as resolveControlGroupFromModel,
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

const EMPTY_CONTROL_GROUP: ControlGroupInfo = {
  joints: [],
  actuators: [],
  qposAdr: [],
  dofAdr: [],
  ctrlAdr: [],
  readQpos: () => new Float64Array(0),
  readCtrl: () => new Float64Array(0),
  writeQpos: () => {},
  writeCtrl: () => {},
};

function isMutableApiRef(
  ref: React.ForwardedRef<MujocoSimAPI>
): ref is React.MutableRefObject<MujocoSimAPI | null> {
  return typeof ref === 'object' && ref !== null && 'current' in ref;
}

// Preallocated force/torque temps for applyForce/applyTorque
const _applyForce = new Float64Array(3);
const _applyTorque = new Float64Array(3);
const _applyPoint = new Float64Array(3);
const _rayPnt = new Float64Array(3);
const _rayVec = new Float64Array(3);
const _rayGeomId = new Int32Array(1);
const _projRaycaster = new THREE.Raycaster();
const _projNdc = new THREE.Vector2();

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function throwIfCameraSequenceAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;

  if (typeof signal.reason === 'object' && signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw new DOMException('Camera sequence recording was aborted.', 'AbortError');
}

function vector3FromArray(values: ArrayLike<number>, offset: number): [number, number, number] {
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function quaternionFromMujocoQuat(values: ArrayLike<number>, offset: number): [number, number, number, number] {
  return [
    values[offset + 1],
    values[offset + 2],
    values[offset + 3],
    values[offset],
  ];
}

function quaternionFromXmat(values: ArrayLike<number>, offset: number): [number, number, number, number] {
  const matrix = new THREE.Matrix4();
  matrix.set(
    values[offset],
    values[offset + 1],
    values[offset + 2],
    0,
    values[offset + 3],
    values[offset + 4],
    values[offset + 5],
    0,
    values[offset + 6],
    values[offset + 7],
    values[offset + 8],
    0,
    0,
    0,
    0,
    1
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function omitResolvedCameraSelectors(
  options: CameraFrameCaptureOptions
): CameraFrameCaptureOptions {
  const { cameraName, siteName, bodyName, ...rest } = options;
  return rest;
}

function countMountedCameraSelectors(options: CameraFrameCaptureOptions) {
  return Number(Boolean(options.cameraName)) +
    Number(Boolean(options.siteName)) +
    Number(Boolean(options.bodyName));
}

function assertMatchingMountedCameraSource(
  key: string,
  requested: CameraFrameCaptureOptions,
  source: CameraFrameCaptureSource
) {
  const selectorCount = countMountedCameraSelectors(requested);
  if (selectorCount !== 1) {
    throw new Error(
      `Camera sequence stream "${key}" must provide exactly one mounted MuJoCo cameraName, siteName, or bodyName selector.`
    );
  }

  if (!isMountedCameraFrameCaptureSource(source)) {
    throw new Error(
      `Camera sequence stream "${key}" resolved to ${source.kind}; use a MuJoCo-mounted camera, site, or body selector for sequence recording.`
    );
  }

  if (
    (requested.cameraName &&
      (source.kind !== 'mujoco-camera' || source.cameraName !== requested.cameraName)) ||
    (requested.siteName &&
      (source.kind !== 'mujoco-site' || source.siteName !== requested.siteName)) ||
    (requested.bodyName &&
      (source.kind !== 'mujoco-body' || source.bodyName !== requested.bodyName))
  ) {
    throw new Error(
      `Camera sequence stream "${key}" resolved to ${source.kind}:${getCameraFrameCaptureSourceTarget(source)} instead of the requested mounted selector.`
    );
  }
}

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
  interpolateRef: React.RefObject<boolean>;
  interpolationStateRef: React.RefObject<BodyInterpolationState>;
  onSelectionRef: React.RefObject<
    ((input: SelectionCallbackInput) => void) | undefined
  >;
  beforeStepCallbacks: React.RefObject<Set<PhysicsStepCallback>>;
  afterStepCallbacks: React.RefObject<Set<PhysicsStepCallback>>;
  resetCallbacks: React.RefObject<Set<() => void>>;
  errorRef: React.RefObject<string | null>;
  bodyRegistryRef: React.RefObject<Map<string, { definition: SceneObject; hasCustomChildren: boolean }>>;
  hiddenBodiesRef: React.RefObject<Set<string>>;
  requestBodyReload: () => void;
  status: 'loading' | 'ready' | 'error';
}

export interface BodyInterpolationState {
  alpha: number;
  previousXpos: Float64Array;
  previousXquat: Float64Array;
  currentXpos: Float64Array;
  currentXquat: Float64Array;
  valid: boolean;
}

const MujocoSimContext = createContext<MujocoSimContextValue | null>(null);

export type UseMujocoResult =
  | { status: 'loading'; isPending: true; isReady: false; isError: false; error: null; api: null; mjModelRef: null; mjDataRef: null }
  | { status: 'error'; isPending: false; isReady: false; isError: true; error: string; api: null; mjModelRef: null; mjDataRef: null }
  | { status: 'ready'; isPending: false; isReady: true; isError: false; error: null;
      api: MujocoSimAPI; mjModelRef: React.RefObject<MujocoModel | null>; mjDataRef: React.RefObject<MujocoData | null> };

export function useMujocoContext(): MujocoSimContextValue {
  const ctx = useContext(MujocoSimContext);
  if (!ctx)
    throw new Error('useMujoco must be used inside <MujocoSimProvider>');
  return ctx;
}

export function useMujoco(): UseMujocoResult {
  const ctx = useMujocoContext();
  if (ctx.status === 'ready') {
    return {
      status: 'ready',
      isPending: false,
      isReady: true,
      isError: false,
      error: null,
      api: ctx.api,
      mjModelRef: ctx.mjModelRef,
      mjDataRef: ctx.mjDataRef,
    };
  }
  if (ctx.status === 'error') {
    return {
      status: 'error',
      isPending: false,
      isReady: false,
      isError: true,
      error: ctx.errorRef.current ?? 'Unknown error',
      api: null,
      mjModelRef: null,
      mjDataRef: null,
    };
  }
  return {
    status: 'loading',
    isPending: true,
    isReady: false,
    isError: false,
    error: null,
    api: null,
    mjModelRef: null,
    mjDataRef: null,
  };
}

export function useBeforePhysicsStep(callback: PhysicsStepCallback) {
  const { beforeStepCallbacks } = useMujocoContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const wrapped: PhysicsStepCallback = (input) => callbackRef.current(input);
    beforeStepCallbacks.current.add(wrapped);
    return () => { beforeStepCallbacks.current.delete(wrapped); };
  }, [beforeStepCallbacks]);
}

export function useAfterPhysicsStep(callback: PhysicsStepCallback) {
  const { afterStepCallbacks } = useMujocoContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const wrapped: PhysicsStepCallback = (input) => callbackRef.current(input);
    afterStepCallbacks.current.add(wrapped);
    return () => { afterStepCallbacks.current.delete(wrapped); };
  }, [afterStepCallbacks]);
}

interface MujocoSimProviderProps {
  mujoco: MujocoModule;
  config: SceneConfig;
  apiRef?: React.ForwardedRef<MujocoSimAPI>;
  onReady?: (input: ReadyCallbackInput) => void;
  onError?: (error: Error) => void;
  onStep?: (input: StepCallbackInput) => void;
  onSelection?: (input: SelectionCallbackInput) => void;
  // Declarative physics config props
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
  interpolate,
  children,
}: MujocoSimProviderProps) {
  const { gl, camera, scene } = useThree();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // --- Refs ---
  const mjModelRef = useRef<MujocoModel | null>(null);
  const mjDataRef = useRef<MujocoData | null>(null);
  const mujocoRef = useRef<MujocoModule>(mujoco);
  const configRef = useRef<SceneConfig>(config);
  const pausedRef = useRef(paused ?? false);
  const speedRef = useRef(speed ?? 1);
  const substepsRef = useRef(substeps ?? 1);
  const interpolateRef = useRef(interpolate ?? false);
  const interpolationStateRef = useRef<BodyInterpolationState>({
    alpha: 1,
    previousXpos: new Float64Array(0),
    previousXquat: new Float64Array(0),
    currentXpos: new Float64Array(0),
    currentXquat: new Float64Array(0),
    valid: false,
  });
  const physicsAccumulatorRef = useRef(0);
  const stepsToRunRef = useRef(0);
  const loadGenRef = useRef(0);

  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const beforeStepCallbacks = useRef(new Set<PhysicsStepCallback>());
  const afterStepCallbacks = useRef(new Set<PhysicsStepCallback>());
  const resetCallbacks = useRef(new Set<() => void>());
  const errorRef = useRef<string | null>(null);
  const bodyRegistryRef = useRef(new Map<string, { definition: SceneObject; hasCustomChildren: boolean }>());
  const hiddenBodiesRef = useRef(new Set<string>());
  const bodyReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { mujocoRef.current = mujoco; }, [mujoco]);

  // Sync declarative props to refs
  useEffect(() => { pausedRef.current = paused ?? false; }, [paused]);
  useEffect(() => { speedRef.current = speed ?? 1; }, [speed]);
  useEffect(() => { substepsRef.current = substeps ?? 1; }, [substeps]);
  useEffect(() => { interpolateRef.current = interpolate ?? false; }, [interpolate]);

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

  // --- Build merged config (base + body registry) ---
  function buildMergedConfig(baseConfig: SceneConfig): SceneConfig {
    if (bodyRegistryRef.current.size === 0) return baseConfig;
    const registeredNames = new Set(bodyRegistryRef.current.keys());
    const baseObjects = (baseConfig.sceneObjects ?? []).filter(o => !registeredNames.has(o.name));
    const registeredBodies = Array.from(bodyRegistryRef.current.values()).map(e => e.definition);
    hiddenBodiesRef.current.clear();
    for (const [name, entry] of bodyRegistryRef.current) {
      if (entry.hasCustomChildren) hiddenBodiesRef.current.add(name);
    }
    return { ...baseConfig, sceneObjects: [...baseObjects, ...registeredBodies] };
  }

  // --- Load scene on mount ---
  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const result = await loadScene(mujoco, buildMergedConfig(config));
        if (disposed) {
          result.mjModel.delete();
          result.mjData.delete();
          return;
        }

        mujocoRef.current = mujoco;
        mjModelRef.current = result.mjModel;
        mjDataRef.current = result.mjData;
        physicsAccumulatorRef.current = 0;
        interpolationStateRef.current.valid = false;

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
          const err = e instanceof Error ? e : new Error(String(e));
          errorRef.current = err.message;
          setStatus('error');
          onError?.(err);
        }
      }
    })();

    return () => {
      disposed = true;
      mjModelRef.current?.delete();
      mjDataRef.current?.delete();
      mjModelRef.current = null;
      mjDataRef.current = null;
      physicsAccumulatorRef.current = 0;
      interpolationStateRef.current.valid = false;
      try { mujoco.FS.unmount('/working'); } catch { /* ignore */ }
    };
  }, [mujoco, config]);

  // Fire onReady and assign external ref when status changes to ready
  useEffect(() => {
    if (status === 'ready') {
      const api = apiRef.current;
      if (onReady) onReady({ api });
      // Assign the forwarded ref
      if (externalApiRef) {
        if (typeof externalApiRef === 'function') {
          externalApiRef(api);
        } else if (isMutableApiRef(externalApiRef)) {
          externalApiRef.current = api;
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
      cb({ model, data });
    }

    const numSubsteps = substepsRef.current;
    if (!interpolateRef.current) {
      // Step physics with substeps
      if (stepsToRunRef.current > 0) {
        for (let s = 0; s < stepsToRunRef.current; s++) {
          mujocoRef.current.mj_step(model, data);
        }
        stepsToRunRef.current = 0;
      } else {
        const startSimTime = data.time;
        const clampedDelta = Math.min(delta, 1 / 15); // cap to avoid spiral of death
        const frameTime = clampedDelta * speedRef.current;
        while (data.time - startSimTime < frameTime) {
          for (let s = 0; s < numSubsteps; s++) {
            mujocoRef.current.mj_step(model, data);
          }
        }
      }
    } else if (stepsToRunRef.current > 0) {
      ensureInterpolationBuffers(model);
      copyBodyPose(data, interpolationStateRef.current.previousXpos, interpolationStateRef.current.previousXquat);
      for (let s = 0; s < stepsToRunRef.current; s++) {
        mujocoRef.current.mj_step(model, data);
      }
      copyBodyPose(data, interpolationStateRef.current.currentXpos, interpolationStateRef.current.currentXquat);
      interpolationStateRef.current.alpha = 1;
      interpolationStateRef.current.valid = true;
      stepsToRunRef.current = 0;
    } else {
      ensureInterpolationBuffers(model);
      const clampedDelta = Math.min(delta, 1 / 15); // cap to avoid spiral of death
      physicsAccumulatorRef.current += clampedDelta * speedRef.current;
      const stepDt = Math.max((model.opt?.timestep ?? 0.002) * Math.max(1, numSubsteps), 1e-6);
      let stepped = false;

      while (physicsAccumulatorRef.current >= stepDt) {
        copyBodyPose(data, interpolationStateRef.current.previousXpos, interpolationStateRef.current.previousXquat);
        for (let s = 0; s < numSubsteps; s++) {
          mujocoRef.current.mj_step(model, data);
        }
        copyBodyPose(data, interpolationStateRef.current.currentXpos, interpolationStateRef.current.currentXquat);
        physicsAccumulatorRef.current -= stepDt;
        stepped = true;
      }

      if (!interpolationStateRef.current.valid) {
        copyBodyPose(data, interpolationStateRef.current.previousXpos, interpolationStateRef.current.previousXquat);
        copyBodyPose(data, interpolationStateRef.current.currentXpos, interpolationStateRef.current.currentXquat);
      }

      interpolationStateRef.current.alpha = Math.min(Math.max(physicsAccumulatorRef.current / stepDt, 0), 1);
      interpolationStateRef.current.valid = true;

      if (!stepped) {
        onStepRef.current?.({ time: data.time, model, data });
        return;
      }
    }

    // After-step callbacks
    for (const cb of afterStepCallbacks.current) {
      cb({ model, data });
    }

    onStepRef.current?.({ time: data.time, model, data });
  }, -1);

  function ensureInterpolationBuffers(model: MujocoModel) {
    const state = interpolationStateRef.current;
    const xposLength = model.nbody * 3;
    const xquatLength = model.nbody * 4;
    if (state.previousXpos.length !== xposLength) state.previousXpos = new Float64Array(xposLength);
    if (state.currentXpos.length !== xposLength) state.currentXpos = new Float64Array(xposLength);
    if (state.previousXquat.length !== xquatLength) state.previousXquat = new Float64Array(xquatLength);
    if (state.currentXquat.length !== xquatLength) state.currentXquat = new Float64Array(xquatLength);
  }

  function copyBodyPose(data: MujocoData, xpos: Float64Array, xquat: Float64Array) {
    xpos.set(data.xpos.subarray(0, xpos.length));
    xquat.set(data.xquat.subarray(0, xquat.length));
  }

  // --- API Methods ---

  const reset = useCallback(() => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    mujocoRef.current.mj_resetData(model, data);

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

    configRef.current.onReset?.({ model, data });
    mujocoRef.current.mj_forward(model, data);

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

  const stepImmediately = useCallback((steps = 1) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return false;

    for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
      for (let i = 0; i < model.nv; i += 1) {
        data.qfrc_applied[i] = 0;
      }
      for (const cb of beforeStepCallbacks.current) {
        cb({ model, data });
      }
      mujocoRef.current.mj_step(model, data);
      for (const cb of afterStepCallbacks.current) {
        cb({ model, data });
      }
      onStepRef.current?.({ time: data.time, model, data });
    }

    physicsAccumulatorRef.current = 0;
    interpolationStateRef.current.valid = false;
    return true;
  }, [mujoco]);

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
    mujocoRef.current.mj_forward(model, data);
  }, [mujoco]);

  const setQpos = useCallback((values: Float64Array | number[]) => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;
    const arr = values instanceof Float64Array ? values : new Float64Array(values);
    data.qpos.set(arr.subarray(0, Math.min(arr.length, model.nq)));
    mujocoRef.current.mj_forward(model, data);
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
    withContacts(data, (contactArray) => {
      for (let i = 0; i < ncon; i++) {
        const c = getContact(contactArray, i);
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
    });
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
      const range: [number, number] = [model.jnt_range[2 * i], model.jnt_range[2 * i + 1]];
      result.push({
        id: i,
        name: getName(model, model.name_jntadr[i]),
        type,
        typeName: JOINT_TYPE_NAMES[type] ?? `unknown(${type})`,
        range,
        limited: range[0] < range[1],
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

  const getControlMapApi = useCallback((): ControlGroupInfo => {
    const model = mjModelRef.current;
    return model ? getControlMapFromModel(model) : EMPTY_CONTROL_GROUP;
  }, []);

  const getActuatedJointsApi = useCallback((): ActuatedJointInfo[] => {
    const model = mjModelRef.current;
    return model ? getActuatedJointsFromModel(model) : [];
  }, []);

  const resolveControlGroupApi = useCallback((selector: ControlGroupSelector): ControlGroupInfo | null => {
    const model = mjModelRef.current;
    return model ? resolveControlGroupFromModel(model, selector) : null;
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

  const getCameras = useCallback((): CameraInfo[] => {
    const model = mjModelRef.current;
    if (!model) return [];
    const ncam = model.ncam ?? 0;
    const nameAddresses = model.name_camadr;
    if (!ncam || !nameAddresses) return [];

    const result: CameraInfo[] = [];
    for (let i = 0; i < ncam; i += 1) {
      const posOffset = i * 3;
      const quatOffset = i * 4;
      result.push({
        id: i,
        name: getName(model, nameAddresses[i]),
        bodyId: model.cam_bodyid?.[i] ?? -1,
        fov: model.cam_fovy?.[i] ?? null,
        position: model.cam_pos
          ? vector3FromArray(model.cam_pos, posOffset)
          : null,
        quaternion: model.cam_quat
          ? quaternionFromMujocoQuat(model.cam_quat, quatOffset)
          : null,
      });
    }
    return result;
  }, []);

  const resolveCameraCaptureOptions = useCallback(
    (options: CameraFrameCaptureOptions = {}): CameraFrameCaptureOptions => {
      const model = mjModelRef.current;
      const data = mjDataRef.current;
      if (!model || !data) {
        return options;
      }

      const baseOptions = omitResolvedCameraSelectors(options);

      if (options.cameraName) {
        const cameraId = findCameraByName(model, options.cameraName);
        if (cameraId < 0) {
          throw new Error(`MuJoCo camera "${options.cameraName}" was not found.`);
        }

        const position = data.cam_xpos
          ? vector3FromArray(data.cam_xpos, cameraId * 3)
          : model.cam_pos
            ? vector3FromArray(model.cam_pos, cameraId * 3)
            : undefined;
        const quaternion = data.cam_xmat
          ? quaternionFromXmat(data.cam_xmat, cameraId * 9)
          : model.cam_quat
            ? quaternionFromMujocoQuat(model.cam_quat, cameraId * 4)
            : undefined;

        if (!position || !quaternion) {
          throw new Error(
            `MuJoCo camera "${options.cameraName}" does not expose a capture pose.`
          );
        }

        return {
          ...baseOptions,
          position,
          quaternion,
          fov: options.fov ?? model.cam_fovy?.[cameraId],
          source: { kind: 'mujoco-camera', cameraName: options.cameraName },
        };
      }

      if (options.siteName) {
        const siteId = findSiteByName(model, options.siteName);
        if (siteId < 0) {
          throw new Error(`MuJoCo site "${options.siteName}" was not found.`);
        }

        return {
          ...baseOptions,
          position: vector3FromArray(data.site_xpos, siteId * 3),
          quaternion: quaternionFromXmat(data.site_xmat, siteId * 9),
          source: { kind: 'mujoco-site', siteName: options.siteName },
        };
      }

      if (options.bodyName) {
        const bodyId = findBodyByName(model, options.bodyName);
        if (bodyId < 0) {
          throw new Error(`MuJoCo body "${options.bodyName}" was not found.`);
        }
        if (!data.xmat) {
          throw new Error(
            `MuJoCo body "${options.bodyName}" does not expose world orientation data.`
          );
        }

        return {
          ...baseOptions,
          position: vector3FromArray(data.xpos, bodyId * 3),
          quaternion: quaternionFromXmat(data.xmat, bodyId * 9),
          source: { kind: 'mujoco-body', bodyName: options.bodyName },
        };
      }

      return options;
    },
    []
  );

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

    mujocoRef.current.mj_forward(model, data);

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

      const result = await loadScene(mujoco, buildMergedConfig(newConfig));

      if (gen !== loadGenRef.current) {
        result.mjModel.delete();
        result.mjData.delete();
        return;
      }

      mjModelRef.current = result.mjModel;
      mjDataRef.current = result.mjData;
      physicsAccumulatorRef.current = 0;
      interpolationStateRef.current.valid = false;
      configRef.current = newConfig;

      setStatus('ready');
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      errorRef.current = e instanceof Error ? e.message : String(e);
      setStatus('error');
      throw e;
    }
  }, [mujoco]);

  const requestBodyReload = useCallback(() => {
    if (bodyReloadTimerRef.current) clearTimeout(bodyReloadTimerRef.current);
    bodyReloadTimerRef.current = setTimeout(() => {
      bodyReloadTimerRef.current = null;
      loadSceneApi(configRef.current);
    }, 0);
  }, [loadSceneApi]);

  const loadFromFilesApi = useCallback(
    async (files: FileList | readonly LocalMujocoFile[], options?: LoadFromFilesOptions): Promise<void> => {
      await loadSceneApi(createSceneConfigFromFiles(files, options));
    },
    [loadSceneApi]
  );

  const addBodyApi = useCallback(async (body: SceneObject): Promise<void> => {
    const current = configRef.current;
    const sceneObjects = [
      ...(current.sceneObjects ?? []).filter((obj) => obj.name !== body.name),
      body,
    ];
    await loadSceneApi({ ...current, sceneObjects });
  }, [loadSceneApi]);

  const removeBodyApi = useCallback(async (name: string): Promise<void> => {
    const current = configRef.current;
    bodyRegistryRef.current.delete(name);
    const sceneObjects = (current.sceneObjects ?? []).filter((obj) => obj.name !== name);
    await loadSceneApi({ ...current, sceneObjects });
  }, [loadSceneApi]);

  const recompileApi = useCallback(async (patches: XmlPatch[] = []): Promise<void> => {
    const current = configRef.current;
    await loadSceneApi({
      ...current,
      xmlPatches: patches.length ? [...(current.xmlPatches ?? []), ...patches] : current.xmlPatches,
    });
  }, [loadSceneApi]);

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

  const getCanvas = useCallback((): HTMLCanvasElement | null => {
    return gl.domElement ?? null;
  }, [gl]);

  const captureFrameApi = useCallback(
    (options = {}) => {
      return captureCanvasFrame({ ...options, target: gl.domElement });
    },
    [gl]
  );

  const captureFrameBlobApi = useCallback(
    (options = {}) => {
      return captureCanvasFrameBlob({ ...options, target: gl.domElement });
    },
    [gl]
  );

  const captureCameraFrameApi = useCallback(
    (options = {}) => {
      return captureCameraFrame(
        gl,
        scene,
        camera,
        resolveCameraCaptureOptions(options)
      );
    },
    [camera, gl, resolveCameraCaptureOptions, scene]
  );

  const captureCameraFrameBlobApi = useCallback(
    (options = {}) => {
      return captureCameraFrameBlob(
        gl,
        scene,
        camera,
        resolveCameraCaptureOptions(options)
      );
    },
    [camera, gl, resolveCameraCaptureOptions, scene]
  );

  const recordCameraSequenceApi = useCallback(
    async (
      options: CameraFrameSequenceOptions
    ): Promise<CameraFrameSequenceResult> => {
      const frameCount = Math.max(0, Math.floor(options.frames));
      const stepsPerFrame = Math.max(0, Math.floor(options.stepsPerFrame ?? 1));
      const cameras = options.cameras;
      const frames: CameraFrameSequenceFrame[] = [];
      const cameraSummaries: CameraFrameSequenceResult['cameraSummaries'] = {};
      const wasPaused = pausedRef.current;
      const retainFrames = options.retainFrames ?? true;
      const requireMountedSources = options.requireMountedSources ?? true;
      let recordedFrameCount = 0;

      async function stepCameraSequence(frameIndex: number, steps: number) {
        const model = mjModelRef.current;
        const data = mjDataRef.current;
        if (!model || !data) {
          throw new Error('MuJoCo scene is not ready for camera sequence stepping.');
        }

        for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
          for (let i = 0; i < model.nv; i += 1) {
            data.qfrc_applied[i] = 0;
          }
          await options.onBeforeStep?.({
            frameIndex,
            stepIndex,
            time: data.time,
            model,
            data,
          });
          for (const cb of beforeStepCallbacks.current) {
            cb({ model, data });
          }
          mujocoRef.current.mj_step(model, data);
          for (const cb of afterStepCallbacks.current) {
            cb({ model, data });
          }
          onStepRef.current?.({ time: data.time, model, data });
          await options.onAfterStep?.({
            frameIndex,
            stepIndex,
            time: data.time,
            model,
            data,
          });
        }

        physicsAccumulatorRef.current = 0;
        interpolationStateRef.current.valid = false;
      }

      if (frameCount === 0 || cameras.length === 0) {
        return {
          frames,
          cameraKeys: cameras.map((sequenceCamera) => sequenceCamera.key),
          cameraSummaries,
          frameCount: 0,
        };
      }

      throwIfCameraSequenceAborted(options.signal);

      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (mjModelRef.current && mjDataRef.current) break;
        await waitForNextAnimationFrame();
        throwIfCameraSequenceAborted(options.signal);
      }
      if (!mjModelRef.current || !mjDataRef.current) {
        throw new Error('MuJoCo scene is not ready for camera sequence recording.');
      }

      const captureSessions = cameras.map((sequenceCamera) => {
        const { key, ...captureOptions } = sequenceCamera;
        const initialCaptureOptions = resolveCameraCaptureOptions(captureOptions);
        const mountedSource = initialCaptureOptions.source;
        if (requireMountedSources) {
          assertMatchingMountedCameraSource(
            key,
            captureOptions,
            mountedSource ?? { kind: 'fallback-camera' }
          );
        }
        return {
          key,
          captureOptions,
          mountedSource,
          session: createCameraFrameCaptureSession(
            gl,
            scene,
            camera,
            initialCaptureOptions
          ),
        };
      });

      try {
        pausedRef.current = true;
        stepsToRunRef.current = 0;
        if (options.reset) reset();

        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          throwIfCameraSequenceAborted(options.signal);
          if (
            stepsPerFrame > 0 &&
            (frameIndex > 0 || options.captureInitialFrame === false)
          ) {
            await stepCameraSequence(frameIndex, stepsPerFrame);
          }
          await waitForNextAnimationFrame();
          throwIfCameraSequenceAborted(options.signal);

          const model = mjModelRef.current;
          const data = mjDataRef.current;
          if (!model || !data) {
            throw new Error('MuJoCo scene is not ready for camera sequence sampling.');
          }
          await options.onSample?.({
            frameIndex,
            time: data.time,
            model,
            data,
          });

          const cameraFrames: Record<string, CameraFrameCaptureResult> = {};
          for (const { key, captureOptions, mountedSource, session } of captureSessions) {
            const resolvedCaptureOptions = resolveCameraCaptureOptions(captureOptions);
            const cameraFrame = await session.captureDataUrlAsync({
              ...resolvedCaptureOptions,
              source: mountedSource ?? resolvedCaptureOptions.source,
            });
            if (requireMountedSources) {
              assertMatchingMountedCameraSource(
                key,
                captureOptions,
                cameraFrame.source
              );
            }
            cameraSummaries[key] = {
              key,
              width: cameraFrame.width,
              height: cameraFrame.height,
              source: cameraFrame.source,
              frameCount: (cameraSummaries[key]?.frameCount ?? 0) + 1,
              firstFrameIndex:
                cameraSummaries[key]?.firstFrameIndex ?? frameIndex,
              lastFrameIndex: frameIndex,
              firstTimestamp:
                cameraSummaries[key]?.firstTimestamp ?? data.time,
              lastTimestamp: data.time,
            };
            cameraFrames[key] = cameraFrame;
          }

          const frame = {
            frameIndex,
            time: data.time,
            cameras: cameraFrames,
          };
          if (retainFrames) {
            frames.push(frame);
          }
          recordedFrameCount += 1;
          await options.onFrame?.(frame);
        }
      } finally {
        for (const { session } of captureSessions) {
          session.dispose();
        }
        pausedRef.current = wasPaused;
      }

      return {
        frames,
        cameraKeys: cameras.map((sequenceCamera) => sequenceCamera.key),
        cameraSummaries,
        frameCount: recordedFrameCount,
      };
    },
    [camera, getTime, gl, mujoco, reset, resolveCameraCaptureOptions, scene]
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
      get config() { return configRef.current; },
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
      getControlMap: getControlMapApi,
      getActuatedJoints: getActuatedJointsApi,
      resolveControlGroup: resolveControlGroupApi,
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
      getCameras,
      getModelOption,
      setGravity,
      setTimestep: setTimestepApi,
      raycast,
      getKeyframeNames,
      getKeyframeCount,
      loadScene: loadSceneApi,
      loadFromFiles: loadFromFilesApi,
      addBody: addBodyApi,
      removeBody: removeBodyApi,
      recompile: recompileApi,
      getCanvas,
      getCanvasSnapshot,
      captureFrame: captureFrameApi,
      captureFrameBlob: captureFrameBlobApi,
      captureCameraFrame: captureCameraFrameApi,
      captureCameraFrameBlob: captureCameraFrameBlobApi,
      recordCameraSequence: recordCameraSequenceApi,
      project2DTo3D,
      setBodyMass,
      setGeomFriction,
      setGeomSize,
      mjModelRef,
      mjDataRef,
    }),
    [
      status, reset, setSpeed, togglePause, setPaused, step,
      getTime, getTimestep, applyKeyframe, saveState, restoreState,
      setQpos, setQvel, getQpos, getQvel, setCtrl, getCtrl,
      getControlMapApi, getActuatedJointsApi, resolveControlGroupApi,
      applyForce, applyTorqueApi, setExternalForce, applyGeneralizedForce,
      getSensorData, getContacts, getBodies, getJoints, getGeoms, getSites,
      getActuatorsApi, getSensors, getCameras, getModelOption, setGravity, setTimestepApi,
      raycast, getKeyframeNames, getKeyframeCount, loadSceneApi,
      loadFromFilesApi, addBodyApi, removeBodyApi, recompileApi,
      getCanvas, getCanvasSnapshot, captureFrameApi, captureFrameBlobApi,
      captureCameraFrameApi, captureCameraFrameBlobApi,
      recordCameraSequenceApi,
      project2DTo3D,
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
      interpolateRef,
      interpolationStateRef,
      onSelectionRef,
      beforeStepCallbacks,
      afterStepCallbacks,
      resetCallbacks,
      errorRef,
      bodyRegistryRef,
      hiddenBodiesRef,
      requestBodyReload,
      status,
    }),
    [api, status, requestBodyReload]
  );

  return (
    <MujocoSimContext.Provider value={contextValue}>
      <SceneRenderer />
      {children}
    </MujocoSimContext.Provider>
  );
}
