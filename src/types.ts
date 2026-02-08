/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CanvasProps } from '@react-three/fiber';
import * as THREE from 'three';

// ---- MuJoCo WASM Types ----

/**
 * Minimal interface for MuJoCo Model to avoid 'any'.
 */
export interface MujocoModel {
  // Counts
  nbody: number;
  ngeom: number;
  nsite: number;
  nu: number;
  njnt: number;
  nq: number;
  nv: number;
  nkey: number;
  nsensor: number;
  nsensordata: number;
  nlight: number;
  ntendon: number;
  nflex: number;
  nmesh: number;
  nmat: number;

  // Name tables
  names: Int8Array;
  name_bodyadr: Int32Array;
  name_jntadr: Int32Array;
  name_geomadr: Int32Array;
  name_siteadr: Int32Array;
  name_actuatoradr: Int32Array;
  name_keyadr: Int32Array;
  name_sensoradr: Int32Array;
  name_tendonadr: Int32Array;

  // Body
  body_mass: Float64Array;
  body_parentid: Int32Array;
  body_jntnum: Int32Array;
  body_jntadr: Int32Array;
  body_pos: Float64Array;
  body_quat: Float64Array;
  body_geomnum: Int32Array;
  body_geomadr: Int32Array;
  body_inertia: Float64Array;

  // Joint
  jnt_qposadr: Int32Array;
  jnt_dofadr: Int32Array;
  jnt_type: Int32Array;
  jnt_range: Float64Array;
  jnt_bodyid: Int32Array;
  jnt_limited: Uint8Array;

  // Geom
  geom_group: Int32Array;
  geom_type: Int32Array;
  geom_size: Float64Array;
  geom_pos: Float64Array;
  geom_quat: Float64Array;
  geom_matid: Int32Array;
  geom_rgba: Float32Array;
  geom_dataid: Int32Array;
  geom_bodyid: Int32Array;
  geom_contype: Int32Array;
  geom_conaffinity: Int32Array;
  geom_friction: Float64Array;

  // Material
  mat_rgba: Float32Array;

  // Mesh
  mesh_vertadr: Int32Array;
  mesh_vertnum: Int32Array;
  mesh_faceadr: Int32Array;
  mesh_facenum: Int32Array;
  mesh_vert: Float32Array;
  mesh_face: Int32Array;
  mesh_normal: Float32Array;

  // Site
  site_bodyid: Int32Array;

  // Actuator
  actuator_trnid: Int32Array;
  actuator_ctrlrange: Float64Array;
  actuator_trntype: Int32Array;
  actuator_gainprm: Float64Array;
  actuator_biasprm: Float64Array;

  // Sensor
  sensor_type: Int32Array;
  sensor_dim: Int32Array;
  sensor_adr: Int32Array;
  sensor_objtype: Int32Array;
  sensor_objid: Int32Array;

  // Keyframe
  key_qpos: Float64Array;
  key_ctrl: Float64Array;
  key_time: Float64Array;
  key_qvel: Float64Array;

  // Light
  light_pos: Float64Array;
  light_dir: Float64Array;
  light_diffuse: Float32Array;
  light_specular: Float32Array;
  light_type: Int32Array;
  light_active: Uint8Array;
  light_castshadow: Uint8Array;
  light_attenuation: Float32Array;
  light_cutoff: Float32Array;
  light_exponent: Float32Array;
  light_intensity: Float32Array;

  // Tendon
  ten_wrapadr: Int32Array;
  ten_wrapnum: Int32Array;
  ten_range: Float64Array;
  ten_rgba: Float32Array;
  ten_width: Float64Array;

  // Flex
  flex_vertadr: Int32Array;
  flex_vertnum: Int32Array;
  flex_faceadr: Int32Array;
  flex_facenum: Int32Array;
  flex_face: Int32Array;
  flex_rgba: Float32Array;

  // Model options
  opt: {
    timestep: number;
    gravity: Float64Array;
    integrator: number;
    [key: string]: unknown;
  };

  delete: () => void;
  [key: string]: unknown;
}

/**
 * Minimal interface for MuJoCo Data to avoid 'any'.
 */
export interface MujocoData {
  time: number;
  qpos: Float64Array;
  qvel: Float64Array;
  ctrl: Float64Array;
  act: Float64Array;
  xpos: Float64Array;
  xquat: Float64Array;
  xfrc_applied: Float64Array;
  qfrc_applied: Float64Array;
  qfrc_bias: Float64Array;
  site_xpos: Float64Array;
  site_xmat: Float64Array;
  sensordata: Float64Array;
  ncon: number;
  contact: unknown;
  cvel: Float64Array;
  cfrc_ext: Float64Array;
  ten_length: Float64Array;
  wrap_xpos: Float64Array;
  ten_wrapadr: Int32Array;
  flexvert_xpos: Float64Array;
  geom_xpos: Float64Array;
  geom_xmat: Float64Array;
  delete: () => void;
  [key: string]: unknown;
}

/**
 * Minimal interface for the MuJoCo WASM Module.
 */
export interface MujocoModule {
  MjModel: { loadFromXML: (path: string) => MujocoModel; [key: string]: unknown };
  MjData: new (model: MujocoModel) => MujocoData;
  MjvOption: new () => { delete: () => void; [key: string]: unknown };
  mj_forward: (m: MujocoModel, d: MujocoData) => void;
  mj_step: (m: MujocoModel, d: MujocoData) => void;
  mj_resetData: (m: MujocoModel, d: MujocoData) => void;
  mj_step1: (m: MujocoModel, d: MujocoData) => void;
  mj_step2: (m: MujocoModel, d: MujocoData) => void;
  mj_applyFT: (
    model: MujocoModel,
    data: MujocoData,
    force: Float64Array,
    torque: Float64Array,
    point: Float64Array,
    bodyId: number,
    qfrc_target: Float64Array
  ) => void;
  mj_ray: (
    model: MujocoModel,
    data: MujocoData,
    pnt: Float64Array,
    vec: Float64Array,
    geomgroup: Uint8Array | null,
    flg_static: number,
    bodyexclude: number,
    geomid: Int32Array
  ) => number;
  mj_name2id: (model: MujocoModel, type: number, name: string) => number;
  mjtObj: Record<string, number>;
  mjtGeom: Record<string, number | {value: number}>;
  mjtJoint: Record<string, number | {value: number}>;
  mjtSensor: Record<string, number | {value: number}>;
  FS: {
      writeFile: (path: string, content: string | Uint8Array) => void;
      readFile: (path: string, opts?: { encoding: string }) => string | Uint8Array;
      mkdir: (path: string) => void;
      unmount: (path: string) => void;
  };
  [key: string]: unknown;
}

// ---- Scene Configuration ----

export interface SceneObject {
  name: string;
  type: 'box' | 'sphere' | 'cylinder';
  size: [number, number, number];
  position: [number, number, number];
  rgba: [number, number, number, number];
  mass?: number;
  freejoint?: boolean;
  friction?: string;
  solref?: string;
  solimp?: string;
  condim?: number;
}

export interface XmlPatch {
  target: string;
  inject?: string;
  injectAfter?: string;
  replace?: [string, string];
}

export interface SceneConfig {
  robotId: string;
  sceneFile: string;
  baseUrl?: string;
  sceneObjects?: SceneObject[];
  tcpSiteName?: string;
  gripperActuatorName?: string;
  numArmJoints?: number;
  homeJoints?: number[];
  xmlPatches?: XmlPatch[];
  onReset?: (model: MujocoModel, data: MujocoData) => void;
}

export interface SceneMarker {
  id: number;
  position: THREE.Vector3;
  label: string;
}

// ---- Physics Config (spec 1.1) ----

export interface PhysicsConfig {
  gravity?: [number, number, number];
  timestep?: number;
  substeps?: number;
  paused?: boolean;
  speed?: number;
  interpolate?: boolean;
}

// ---- IK ----

export type IKSolveFn = (
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  currentQ: number[]
) => number[] | null;

// ---- Callbacks ----

export type PhysicsStepCallback = (
  model: MujocoModel,
  data: MujocoData
) => void;

// ---- State Management (spec 4.1) ----

export interface StateSnapshot {
  time: number;
  qpos: Float64Array;
  qvel: Float64Array;
  ctrl: Float64Array;
  act: Float64Array;
  qfrc_applied: Float64Array;
}

// ---- Model Introspection (spec 5.1) ----

export interface BodyInfo {
  id: number;
  name: string;
  mass: number;
  parentId: number;
}

export interface JointInfo {
  id: number;
  name: string;
  type: number;
  typeName: string;
  range: [number, number];
  limited: boolean;
  bodyId: number;
  qposAdr: number;
  dofAdr: number;
}

export interface GeomInfo {
  id: number;
  name: string;
  type: number;
  typeName: string;
  size: [number, number, number];
  bodyId: number;
}

export interface SiteInfo {
  id: number;
  name: string;
  bodyId: number;
}

export interface ActuatorInfo {
  id: number;
  name: string;
  range: [number, number];
}

export interface SensorInfo {
  id: number;
  name: string;
  type: number;
  typeName: string;
  dim: number;
  adr: number;
}

// ---- Contacts (spec 2.4, 2.5) ----

export interface ContactInfo {
  geom1: number;
  geom1Name: string;
  geom2: number;
  geom2Name: string;
  pos: [number, number, number];
  depth: number;
}

// ---- Raycast (spec 7.1) ----

export interface RayHit {
  point: THREE.Vector3;
  bodyId: number;
  geomId: number;
  distance: number;
}

// ---- Model Options (spec 5.3) ----

export interface ModelOptions {
  timestep: number;
  gravity: [number, number, number];
  integrator: number;
}

// ---- Trajectory (spec 13.1, 13.2) ----

export interface TrajectoryFrame {
  time: number;
  qpos: Float64Array;
  qvel?: Float64Array;
  ctrl?: Float64Array;
  sensordata?: Float64Array;
}

export interface TrajectoryData {
  frames: TrajectoryFrame[];
  fps: number;
}

// ---- Keyboard Teleop (spec 12.1) ----

export interface KeyBinding {
  actuator: string;
  delta?: number;
  toggle?: [number, number];
  set?: number;
}

export interface KeyboardTeleopConfig {
  bindings: Record<string, KeyBinding>;
  enabled?: boolean;
}

// ---- Policy (spec 10.1) ----

export interface PolicyConfig {
  frequency: number;
  onObservation: (model: MujocoModel, data: MujocoData) => Float32Array | Float64Array | number[];
  onAction: (action: Float32Array | Float64Array | number[], model: MujocoModel, data: MujocoData) => void;
}

// ---- Debug Component (spec 6.1) ----

export interface DebugProps {
  showGeoms?: boolean;
  showSites?: boolean;
  showJoints?: boolean;
  showContacts?: boolean;
  showCOM?: boolean;
  showInertia?: boolean;
  showTendons?: boolean;
}

// ---- Component Props ----

export interface IkGizmoProps {
  siteName?: string;
  scale?: number;
  onDrag?: (position: THREE.Vector3, quaternion: THREE.Quaternion) => void;
}

export interface DragInteractionProps {
  stiffness?: number;
  showArrow?: boolean;
}

export interface SceneLightsProps {
  /** Override intensity for all MJCF lights. Default: 1.0. */
  intensity?: number;
}

export interface TrajectoryPlayerProps {
  trajectory: number[][];
  fps?: number;
  loop?: boolean;
  playing?: boolean;
  onFrame?: (frameIdx: number) => void;
}

export interface SelectionHighlightProps {
  bodyId: number | null;
  color?: string;
  emissiveIntensity?: number;
}

export interface ContactListenerProps {
  body: string;
  onContactEnter?: (info: ContactInfo) => void;
  onContactExit?: (info: ContactInfo) => void;
}

// ---- Public API (spec: full surface) ----

export interface MujocoSimAPI {
  // State
  readonly status: 'loading' | 'ready' | 'error';
  readonly config: SceneConfig;

  // Simulation control (spec 1.1, 1.2, 1.3)
  reset(): void;
  setSpeed(multiplier: number): void;
  togglePause(): boolean;
  setPaused(paused: boolean): void;
  step(n?: number): void;
  getTime(): number;
  getTimestep(): number;
  applyKeyframe(nameOrIndex: string | number): void;

  // State management (spec 4.1, 4.2, 4.3)
  saveState(): StateSnapshot;
  restoreState(snapshot: StateSnapshot): void;
  setQpos(values: Float64Array | number[]): void;
  setQvel(values: Float64Array | number[]): void;
  getQpos(): Float64Array;
  getQvel(): Float64Array;

  // Actuator / control (spec 3.1)
  setCtrl(nameOrValues: string | Record<string, number>, value?: number): void;
  getCtrl(): Float64Array;

  // Force application (spec 8.1)
  applyForce(bodyName: string, force: THREE.Vector3, point?: THREE.Vector3): void;
  applyTorque(bodyName: string, torque: THREE.Vector3): void;
  setExternalForce(bodyName: string, force: THREE.Vector3, torque: THREE.Vector3): void;
  applyGeneralizedForce(values: Float64Array | number[]): void;

  // Sensors (spec 2.1)
  getSensorData(name: string): Float64Array | null;

  // Contacts (spec 2.4)
  getContacts(): ContactInfo[];

  // Model introspection (spec 5.1, 5.2)
  getBodies(): BodyInfo[];
  getJoints(): JointInfo[];
  getGeoms(): GeomInfo[];
  getSites(): SiteInfo[];
  getActuators(): ActuatorInfo[];
  getSensors(): SensorInfo[];

  // Model parameters (spec 5.3)
  getModelOption(): ModelOptions;
  setGravity(g: [number, number, number]): void;
  setTimestep(dt: number): void;

  // Raycasting (spec 7.1)
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDist?: number): RayHit | null;

  // Keyframes (spec 4.2)
  getKeyframeNames(): string[];
  getKeyframeCount(): number;

  // Model loading (spec 9.1)
  loadScene(newConfig: SceneConfig): Promise<void>;

  // IK control
  setIkEnabled(enabled: boolean): void;
  moveTarget(pos: THREE.Vector3, duration?: number): void;
  syncTargetToSite(): void;
  solveIK(
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    currentQ: number[]
  ): number[] | null;
  getGizmoStats(): { pos: THREE.Vector3; rot: THREE.Euler } | null;

  // Canvas / camera
  getCanvasSnapshot(width?: number, height?: number, mimeType?: string): string;
  project2DTo3D(
    x: number,
    y: number,
    cameraPos: THREE.Vector3,
    lookAt: THREE.Vector3
  ): { point: THREE.Vector3; bodyId: number; geomId: number } | null;

  // Domain randomization (spec 10.3)
  setBodyMass(name: string, mass: number): void;
  setGeomFriction(name: string, friction: [number, number, number]): void;
  setGeomSize(name: string, size: [number, number, number]): void;
  getCameraState(): { position: THREE.Vector3; target: THREE.Vector3 };
  moveCameraTo(
    position: THREE.Vector3,
    target: THREE.Vector3,
    durationMs: number
  ): Promise<void>;

  // Internal refs for advanced use
  readonly mjModelRef: React.RefObject<MujocoModel | null>;
  readonly mjDataRef: React.RefObject<MujocoData | null>;
}

// ---- Canvas Props ----

export type MujocoCanvasProps = Omit<CanvasProps, 'onError'> & {
  config: SceneConfig;
  onReady?: (api: MujocoSimAPI) => void;
  onError?: (error: Error) => void;
  onStep?: (time: number) => void;
  onSelection?: (bodyId: number, name: string) => void;
  // Declarative physics config (spec 1.1)
  gravity?: [number, number, number];
  timestep?: number;
  substeps?: number;
  paused?: boolean;
  speed?: number;
  interpolate?: boolean;
  gravityCompensation?: boolean;
  mjcfLights?: boolean;
};

// ---- Hook Return Types ----

export interface SitePositionResult {
  position: React.RefObject<THREE.Vector3>;
  quaternion: React.RefObject<THREE.Quaternion>;
}

export interface MujocoContextValue {
  mujoco: MujocoModule | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

export interface SensorResult {
  value: React.RefObject<Float64Array>;
  size: number;
}

export interface BodyStateResult {
  position: React.RefObject<THREE.Vector3>;
  quaternion: React.RefObject<THREE.Quaternion>;
  linearVelocity: React.RefObject<THREE.Vector3>;
  angularVelocity: React.RefObject<THREE.Vector3>;
}

export interface JointStateResult {
  position: React.RefObject<number | Float64Array>;
  velocity: React.RefObject<number | Float64Array>;
}
