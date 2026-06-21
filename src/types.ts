/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import type { ReactNode } from 'react';
import type { CanvasProps, ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';

// ---- Register (type-safe named resources) ----

/**
 * Module augmentation interface for type-safe resource names.
 *
 * Declare your model's resource names via module augmentation:
 * ```ts
 * declare module 'mujoco-react' {
 *   interface Register {
 *     models: {
 *       panda: {
 *         actuators: 'joint1' | 'joint2' | 'gripper';
 *         sensors: 'force_sensor' | 'torque_sensor';
 *         bodies: 'link0' | 'link1' | 'hand';
 *       };
 *     };
 *     actuators: 'joint1' | 'joint2' | 'gripper';
 *     sensors: 'force_sensor' | 'torque_sensor';
 *     bodies: 'link0' | 'link1' | 'hand';
 *   }
 * }
 * ```
 *
 * When no augmentation is declared, all names fall back to `string`.
 */
export interface Register {}

export type RegisteredModelMap = Register extends { models: infer T extends Record<string, Record<string, string>> }
  ? T
  : never;
export type Models = [RegisteredModelMap] extends [never] ? string : Extract<keyof RegisteredModelMap, string>;
export type ModelResource<TModel extends string, TKey extends string> =
  [RegisteredModelMap] extends [never]
    ? string
    : TModel extends keyof RegisteredModelMap
      ? TKey extends keyof RegisteredModelMap[TModel]
        ? RegisteredModelMap[TModel][TKey]
        : string
      : never;
export type ModelActuators<TModel extends string> = ModelResource<TModel, 'actuators'>;
export type ModelSensors<TModel extends string> = ModelResource<TModel, 'sensors'>;
export type ModelBodies<TModel extends string> = ModelResource<TModel, 'bodies'>;
export type ModelJoints<TModel extends string> = ModelResource<TModel, 'joints'>;
export type ModelSites<TModel extends string> = ModelResource<TModel, 'sites'>;
export type ModelGeoms<TModel extends string> = ModelResource<TModel, 'geoms'>;
export type ModelKeyframes<TModel extends string> = ModelResource<TModel, 'keyframes'>;
export type ModelCameras<TModel extends string> = ModelResource<TModel, 'cameras'>;

export type RegisterResourceKey = 'actuators' | 'sensors' | 'bodies' | 'joints' | 'sites' | 'geoms' | 'keyframes' | 'cameras';
export type ModelResourceObject<TModel extends string, TKey extends RegisterResourceKey> =
  string extends ModelResource<TModel, TKey>
    ? Record<string, string>
    : { readonly [K in ModelResource<TModel, TKey>]: K };
export type ModelResourceCategory<TKey extends RegisterResourceKey> =
  string extends Models
    ? Record<string, Record<string, string>>
    : { readonly [TModel in Models]: ModelResourceObject<TModel, TKey> };
export type ModelResourceRegistry =
  string extends Models
    ? Record<string, Record<RegisterResourceKey, Record<string, string>>>
    : { readonly [TModel in Models]: { readonly [TKey in RegisterResourceKey]: ModelResourceObject<TModel, TKey> } };

type RuntimeModelResources = Record<string, Record<RegisterResourceKey, Record<string, string>>>;
type RuntimeModelResourceRegistration = Readonly<Record<string, Readonly<Record<RegisterResourceKey, Readonly<Record<string, string>>>>>>;

const runtimeModelResources: RuntimeModelResources = {};
const REGISTER_RESOURCE_KEYS: RegisterResourceKey[] = ['actuators', 'sensors', 'bodies', 'joints', 'sites', 'geoms', 'keyframes', 'cameras'];

function createEmptyRuntimeResources(): Record<RegisterResourceKey, Record<string, string>> {
  return {
    actuators: {},
    sensors: {},
    bodies: {},
    joints: {},
    sites: {},
    geoms: {},
    keyframes: {},
    cameras: {},
  };
}

export function registerModelResources(resources: RuntimeModelResourceRegistration): void {
  for (const [model, modelResources] of Object.entries(resources)) {
    const existing = runtimeModelResources[model] ?? createEmptyRuntimeResources();
    for (const key of REGISTER_RESOURCE_KEYS) {
      existing[key] = { ...existing[key], ...(modelResources[key] ?? {}) };
    }
    runtimeModelResources[model] = existing;
  }
}

function createResourceCategory<TKey extends RegisterResourceKey>(key: TKey): ModelResourceCategory<TKey> {
  return new Proxy({}, {
    get(_target, model) {
      if (typeof model !== 'string') return undefined;
      return runtimeModelResources[model]?.[key] ?? {};
    },
    ownKeys() {
      return Reflect.ownKeys(runtimeModelResources);
    },
    getOwnPropertyDescriptor(_target, model) {
      if (typeof model !== 'string' || !(model in runtimeModelResources)) return undefined;
      return { enumerable: true, configurable: true };
    },
  }) as ModelResourceCategory<TKey>;
}

export const ModelResources: ModelResourceRegistry = new Proxy(runtimeModelResources, {
  get(target, model) {
    if (typeof model !== 'string') return undefined;
    return target[model] ?? createEmptyRuntimeResources();
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, model) {
    if (typeof model !== 'string' || !(model in target)) return undefined;
    return { enumerable: true, configurable: true };
  },
}) as ModelResourceRegistry;

export const ModelActuators: ModelResourceCategory<'actuators'> = createResourceCategory('actuators');
export const ModelSensors: ModelResourceCategory<'sensors'> = createResourceCategory('sensors');
export const ModelBodies: ModelResourceCategory<'bodies'> = createResourceCategory('bodies');
export const ModelJoints: ModelResourceCategory<'joints'> = createResourceCategory('joints');
export const ModelSites: ModelResourceCategory<'sites'> = createResourceCategory('sites');
export const ModelGeoms: ModelResourceCategory<'geoms'> = createResourceCategory('geoms');
export const ModelKeyframes: ModelResourceCategory<'keyframes'> = createResourceCategory('keyframes');
export const ModelCameras: ModelResourceCategory<'cameras'> = createResourceCategory('cameras');

export type Actuators = Register extends { actuators: infer T extends string } ? T : string;
export type Sensors = Register extends { sensors: infer T extends string } ? T : string;
export type Bodies = Register extends { bodies: infer T extends string } ? T : string;
export type Joints = Register extends { joints: infer T extends string } ? T : string;
export type Sites = Register extends { sites: infer T extends string } ? T : string;
export type Geoms = Register extends { geoms: infer T extends string } ? T : string;
export type Keyframes = Register extends { keyframes: infer T extends string } ? T : string;
export type Cameras = Register extends { cameras: infer T extends string } ? T : string;

// ---- MuJoCo WASM Types ----

/**
 * A single MuJoCo contact from the WASM module.
 * Accessed via `data.contact.get(i)`.
 */
export interface MujocoContact {
  geom1: number;
  geom2: number;
  pos: Float64Array;
  frame: Float64Array;
  dist: number;
}

/**
 * WASM contact array — supports indexed access via `.get(i)`.
 */
export interface MujocoContactArray {
  get(i: number): MujocoContact | undefined;
  delete?: () => void;
}

/**
 * Read a single contact from an already-acquired WASM contact array.
 * Returns undefined if the access fails (WASM heap issue, bad index, etc.).
 */
export function getContact(contacts: MujocoContactArray, i: number): MujocoContact | undefined {
  try {
    return contacts.get(i);
  } catch {
    return undefined;
  }
}

/**
 * Access the current contact vector and release the copied WASM handle afterwards.
 */
export function withContacts<T>(data: MujocoData, read: (contacts: MujocoContactArray) => T): T {
  const contacts = data.contact;
  try {
    return read(contacts);
  } finally {
    contacts.delete?.();
  }
}

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
  ncam?: number;

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
  name_camadr?: Int32Array;

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

  // Default configuration
  qpos0: Float64Array;

  // Joint
  jnt_qposadr: Int32Array;
  jnt_dofadr: Int32Array;
  jnt_type: Int32Array;
  jnt_range: Float64Array;
  jnt_bodyid: Int32Array;
  jnt_pos: Float64Array;
  jnt_axis: Float64Array;
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

  // Camera
  cam_bodyid?: Int32Array;
  cam_pos?: Float64Array;
  cam_quat?: Float64Array;
  cam_fovy?: Float64Array;

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
  cam_xpos?: Float64Array;
  cam_xmat?: Float64Array;
  xmat?: Float64Array;
  sensordata: Float64Array;
  ncon: number;
  contact: MujocoContactArray;
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
  MjModel: {
    from_xml_path?: (path: string) => MujocoModel;
    from_xml_string?: (xml: string, vfs?: unknown) => MujocoModel;
    loadFromXML?: (path: string) => MujocoModel;
    [key: string]: unknown;
  };
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
  /** MuJoCo geom group. Group 3 is conventionally used for collision-only helper geoms. */
  group?: number;
}

export interface XmlPatch {
  target: string;
  inject?: string;
  injectAfter?: string;
  replace?: [string, string];
}

export type LocalMujocoFile = File;

export interface LoadFromFilesOptions {
  /** Entry MJCF/URDF file. Inferred from scene.xml, model.xml, robot.xml, or the first XML/URDF file when omitted. */
  sceneFile?: string;
  /** Additional MJCF environment XML files merged into the entry scene before MuJoCo compilation. */
  environmentFiles?: string[];
  homeJoints?: number[];
  xmlPatches?: XmlPatch[];
  sceneObjects?: SceneObject[];
  onReset?: (input: ResetCallbackInput) => void;
}

export interface SceneConfig {
  /** Base URL for fetching model files. The loader fetches `src + sceneFile` and follows dependencies. */
  src: string;
  /** Entry MJCF XML or URDF file name, e.g. 'scene.xml' or 'robot.urdf'. */
  sceneFile: string;
  /** Browser-selected files for local MJCF/URDF loading. Preserves webkitRelativePath when available. */
  files?: readonly LocalMujocoFile[];
  /**
   * Additional MJCF environment XML files merged into the entry scene before compilation.
   *
   * Use this for static collision/physics layers such as a Gaussian-splat
   * environment's proxy `scene.xml`; render the splat itself as a separate
   * visual layer.
   */
  environmentFiles?: string[];
  sceneObjects?: SceneObject[];
  homeJoints?: number[];
  xmlPatches?: XmlPatch[];
  onReset?: (input: ResetCallbackInput) => void;
}

// ---- IK Controller Config ----

export type ResourceSelector<TInfo, TName extends string = string> =
  | TName
  | readonly TName[]
  | RegExp
  | ((info: TInfo) => boolean);

export interface IkConfig {
  /** MuJoCo site name for IK target. */
  siteName: Sites;
  /**
   * Explicit joints for IK. When omitted, the controller infers scalar hinge/slide
   * joints by walking from the site body to the model root.
   */
  joints?: ResourceSelector<JointInfo, Joints>;
  /** Explicit actuators for IK control output. */
  actuators?: ResourceSelector<ActuatorInfo, Actuators>;
  /**
   * Number of joints to solve for, assuming legacy contiguous qpos/ctrl layout
   * starting at index 0. Prefer inferred IK or `joints`/`actuators`.
   */
  numJoints?: number;
  /** Custom IK solver. When omitted, uses built-in Damped Least-Squares solver. */
  ikSolveFn?: IKSolveFn;
  /** DLS damping. Default: 0.01. */
  damping?: number;
  /** Position error weight for the built-in DLS solver. Default: 1. */
  posWeight?: number;
  /** Orientation error weight for the built-in DLS solver. Default: 0.3. */
  rotWeight?: number;
  /** Solver convergence tolerance. Default: 1e-3. */
  tolerance?: number;
  /** Finite-difference step used by the built-in DLS solver. Default: 1e-6. */
  epsilon?: number;
  /** Max solver iterations. Default: 50. */
  maxIterations?: number;
}

export interface IkContextValue {
  ikEnabledRef: React.RefObject<boolean>;
  ikCalculatingRef: React.RefObject<boolean>;
  ikTargetRef: React.RefObject<THREE.Group>;
  siteIdRef: React.RefObject<number>;
  setIkEnabled: (enabled: boolean) => void;
  moveTarget: (pos: THREE.Vector3, duration?: number) => void;
  syncTargetToSite: () => void;
  solveIK: (input: IkSolveInput) => number[] | null;
  getGizmoStats: () => { pos: THREE.Vector3; rot: THREE.Euler } | null;
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
}

// ---- IK ----

export type IKSolveFn = (
  input: IkSolveInput
) => number[] | null;

export interface IkSolveInput {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  currentQ: number[];
  context?: IKSolveContext;
}

export interface IKSolveContext {
  model: MujocoModel;
  data: MujocoData;
  siteId: number;
  controlGroup: ControlGroupInfo;
}

// ---- Callbacks ----

export interface PhysicsStepInput {
  model: MujocoModel;
  data: MujocoData;
}

export interface ResetCallbackInput extends PhysicsStepInput {}

export interface ReadyCallbackInput {
  api: MujocoSimAPI;
}

export interface StepCallbackInput {
  time: number;
  model: MujocoModel;
  data: MujocoData;
}

export interface SelectionCallbackInput {
  bodyId: number;
  name: string;
}

export type PhysicsStepCallback = (input: PhysicsStepInput) => void;

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

export interface ActuatedJointInfo extends JointInfo {
  actuatorId: number;
  actuatorName: string;
  ctrlAdr: number;
  ctrlRange: [number, number];
}

export interface ControlJointInfo extends JointInfo {
  actuatorId: number | null;
  actuatorName: string | null;
  ctrlAdr: number | null;
  ctrlRange: [number, number] | null;
}

export interface ControlGroupSelector {
  /** Infer a kinematic chain from a MuJoCo site. */
  siteName?: Sites;
  /** Infer a kinematic chain from a body. */
  bodyName?: Bodies;
  /** Select joints by name, names, regex, or predicate. */
  joints?: ResourceSelector<JointInfo, Joints>;
  /** Select actuators by name, names, regex, or predicate. */
  actuators?: ResourceSelector<ActuatorInfo, Actuators>;
}

export interface ControlGroupInfo {
  /** Joints in solve/control order. */
  joints: ControlJointInfo[];
  /** Actuators in control output order. */
  actuators: ActuatorInfo[];
  /** qpos addresses for scalar hinge/slide joints. */
  qposAdr: number[];
  /** dof addresses for scalar hinge/slide joints. */
  dofAdr: number[];
  /** ctrl addresses matching writable actuators. */
  ctrlAdr: number[];
  readQpos(data: MujocoData): Float64Array;
  readCtrl(data: MujocoData): Float64Array;
  writeQpos(data: MujocoData, values: ArrayLike<number>): void;
  writeCtrl(data: MujocoData, values: ArrayLike<number>): void;
}

export interface SensorInfo {
  id: number;
  name: string;
  type: number;
  typeName: string;
  dim: number;
  adr: number;
}

export interface CameraInfo {
  id: number;
  name: string;
  bodyId: number;
  fov: number | null;
  position: [number, number, number] | null;
  quaternion: [number, number, number, number] | null;
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

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'completed';

// ---- Keyboard Teleop (spec 12.1) ----

export interface KeyBinding {
  actuator: Actuators;
  delta?: number;
  toggle?: [number, number];
  set?: number;
}

export interface KeyboardTeleopConfig {
  bindings: Record<string, KeyBinding>;
  enabled?: boolean;
}

// ---- Policy (spec 10.1) ----

export type PolicyVector = Float32Array | Float64Array | number[];

export interface PolicyObservationInput {
  model: MujocoModel;
  data: MujocoData;
}

export interface PolicyInferenceInput extends PolicyObservationInput {
  observation: PolicyVector;
}

export interface PolicyActionInput extends PolicyInferenceInput {
  action: PolicyVector;
}

export interface PolicyConfig {
  frequency: number;
  enabled?: boolean;
  onObservation: (input: PolicyObservationInput) => PolicyVector;
  /** Run policy inference. Omit to pass observations directly to `onAction` for custom inline controllers. */
  infer?: (input: PolicyInferenceInput) => PolicyVector;
  onAction: (input: PolicyActionInput) => void;
}

// ---- Observation Builder ----

export type ObservationOutput = 'float32' | 'float64';

export interface ObservationConfig {
  /** Include scalar simulation time. */
  time?: boolean;
  /** Include all qpos values. */
  qpos?: boolean;
  /** Include all qvel values. */
  qvel?: boolean;
  /** Include all ctrl values. */
  ctrl?: boolean;
  /** Include all actuator activation values. */
  act?: boolean;
  /** Include all raw sensordata values. */
  sensordata?: boolean;
  /** Include named sensor values in the configured order. */
  sensors?: readonly Sensors[];
  /** Include named site world positions in the configured order. */
  sites?: readonly Sites[];
  /** Include world gravity projected into each named body's local frame. */
  projectedGravity?: Bodies | readonly Bodies[];
  /** Output array type. Defaults to Float32Array. */
  output?: ObservationOutput;
}

export interface ObservationLayoutItem {
  name: string;
  start: number;
  size: number;
}

export interface ObservationResult {
  values: Float32Array | Float64Array;
  layout: ObservationLayoutItem[];
}

export interface ObservationHandle {
  /** Read a fresh observation from the current live MuJoCo model/data refs. */
  read(): ObservationResult;
  /** Read just the vector values for policy inference. */
  readValues(): Float32Array | Float64Array;
}

// ---- Debug Component (spec 6.1) ----

export interface DebugProps {
  showGeoms?: boolean;
  showSites?: boolean;
  showJoints?: boolean;
  showCameras?: boolean;
  showContacts?: boolean;
  showCOM?: boolean;
  showInertia?: boolean;
  showTendons?: boolean;
}

// ---- Component Props ----

export interface IkGizmoProps {
  controller: IkContextValue;
  siteName?: string;
  scale?: number;
  onDrag?: (input: IkGizmoDragInput) => void;
}

export interface IkGizmoDragInput {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export type KeyboardIkTargetAction =
  | 'x+'
  | 'x-'
  | 'y+'
  | 'y-'
  | 'z+'
  | 'z-'
  | 'pitch+'
  | 'pitch-'
  | 'yaw+'
  | 'yaw-'
  | 'roll+'
  | 'roll-';

export interface KeyboardIkTargetBinding {
  /** KeyboardEvent.code, e.g. `KeyW`, `ArrowUp`, `Space`. */
  code: string;
  action: KeyboardIkTargetAction;
  /** Override translation speed in meters/second for this binding. */
  translateSpeed?: number;
  /** Override rotation speed in radians/second for this binding. */
  rotateSpeed?: number;
}

export interface KeyboardIkTargetConfig {
  controller: IkContextValue | null;
  bindings: KeyboardIkTargetBinding[];
  enabled?: boolean;
  /** Default translation speed in meters/second. Default: 0.25. */
  translateSpeed?: number;
  /** Default rotation speed in radians/second. Default: 1.0. */
  rotateSpeed?: number;
  /** Apply translation and rotation axes in world or current target space. Default: `world`. */
  frame?: 'world' | 'target';
  /** Enable IK while keys are active. Default: true. */
  autoEnableIk?: boolean;
  /** Sync target to current site when keyboard control starts. Default: true. */
  syncOnStart?: boolean;
  /** Prevent browser default behavior for bound keys. Default: true. */
  preventDefault?: boolean;
}

export interface DragInteractionProps {
  stiffness?: number;
  showArrow?: boolean;
}

export interface SceneLightsProps {
  /** Override intensity for all MJCF lights. Default: 1.0. */
  intensity?: number;
}

// ---- Visual scenarios / 3DGS composition ----

export type ScenarioLightingPreset = 'studio' | 'warehouse' | 'low-light' | 'splat';
export type SplatFormat = 'spz' | 'ply' | 'splat';
export type SplatRendererKind = 'spark' | 'custom';
export type SplatCollisionPrimitive = 'plane' | 'box' | 'sphere' | 'capsule' | 'mesh';

export interface ScenarioCameraConfig {
  jitter?: number;
  exposure?: number;
  noise?: number;
  blur?: number;
}

export interface ScenarioMaterialConfig {
  randomizeObjectColors?: boolean;
  randomizeTableMaterial?: boolean;
  roughness?: number;
  metalness?: number;
}

export interface SplatAssetConfig {
  src: string;
  /** Common browser-friendly splat format. Renderer-specific loaders may accept more. */
  format?: SplatFormat;
  /** Optional renderer hint. The library does not import renderer-specific code. */
  renderer?: SplatRendererKind;
}

export interface SplatScenarioConfig {
  enabled: boolean;
  /** Common browser-friendly splat format. Renderer-specific loaders may accept more. */
  format?: SplatFormat;
  src?: string;
  requiresCollisionProxy?: boolean;
  collisionProxy?: SplatCollisionProxyConfig | null;
}

export interface SplatCollisionProxyConfig {
  /** MJCF/XML file or artifact path that provides physics collision for the visual splat. */
  xmlPath?: string;
  /** Human-readable status for authoring and validation flows. */
  status?: 'missing' | 'planned' | 'generated' | 'validated';
  /** Primitive proxy shapes expected in the MJCF collision proxy. */
  primitives?: SplatCollisionPrimitive[];
  /** Optional notes that should travel with scene variants and rollout metadata. */
  notes?: string[];
}

export interface PairedSplatEnvironmentConfig {
  id: string;
  label: string;
  description?: string;
  /** Visual-only Gaussian splat asset. */
  splat: SplatAssetConfig;
  /** Optional MJCF/XML contact geometry paired with the visual splat. */
  collisionProxy?: SplatCollisionProxyConfig & { xmlPath: string };
}

export const SplatEnvironmentReadinessStatus = {
  Disabled: 'disabled',
  MissingSplat: 'missing-splat',
  MissingCollisionProxy: 'missing-collision-proxy',
  UnsupportedFormat: 'unsupported-format',
  Ready: 'ready',
} as const;

export type SplatEnvironmentReadinessStatus =
  (typeof SplatEnvironmentReadinessStatus)[keyof typeof SplatEnvironmentReadinessStatus];

export interface SplatEnvironmentReadiness {
  status: SplatEnvironmentReadinessStatus;
  ready: boolean;
  requiresCollisionProxy: boolean;
  missing: Array<'splat' | 'collisionProxy'>;
  format?: SplatFormat;
  renderer?: SplatRendererKind;
  message: string;
}

export interface SplatEnvironmentMetadataInput {
  environment?: PairedSplatEnvironmentConfig;
  scenario?: VisualScenarioConfig;
  renderer?: SplatRendererKind;
  src?: string;
  format?: SplatFormat;
  collisionProxy?: SplatCollisionProxyConfig;
}

export interface SplatEnvironmentMetadata {
  src?: string;
  format: SplatFormat;
  collisionProxy?: SplatCollisionProxyConfig;
  readiness: SplatEnvironmentReadiness;
  userData: Record<string, unknown>;
}

export interface ResolvedScenarioCameraConfig {
  jitter: number;
  exposure: number;
  noise: number;
  blur: number;
}

export interface ResolvedScenarioMaterialConfig {
  randomizeObjectColors: boolean;
  randomizeTableMaterial: boolean;
  roughness?: number;
  metalness?: number;
}

export interface VisualScenarioExecutionContext {
  scenarioId: string;
  scenarioLabel: string;
  variantId?: string;
  seed: number;
  lighting: ScenarioLightingPreset;
  environment?: string;
  camera: ResolvedScenarioCameraConfig;
  materials: ResolvedScenarioMaterialConfig;
  splatEnabled: boolean;
  splatSrc?: string;
  splatFormat: SplatFormat;
  splatRenderer?: SplatRendererKind;
  collisionProxyXmlPath?: string;
  collisionProxyStatus?: SplatCollisionProxyConfig['status'];
  collisionProxyPrimitives: SplatCollisionPrimitive[];
  readiness: SplatEnvironmentReadiness;
  transformSource: 'visualScenario.camera';
}

export interface VisualScenarioExecutionContextInput {
  scenario?: VisualScenarioConfig;
  environment?: PairedSplatEnvironmentConfig;
  renderer?: SplatRendererKind;
  variantId?: string;
  enabled?: boolean;
}

export type SplatSceneInput =
  | PairedSplatEnvironmentConfig
  | VisualScenarioConfig
  | undefined
  | null;

export interface SplatSceneConfigInput {
  sceneConfig: SceneConfig;
  scenario?: VisualScenarioConfig;
  environment?: PairedSplatEnvironmentConfig;
  enabled?: boolean;
  renderer?: SplatRendererKind;
}

export interface SplatSceneConfigState {
  environment: PairedSplatEnvironmentConfig | undefined;
  sceneConfig: SceneConfig;
  enabled: boolean;
  readiness: SplatEnvironmentReadiness;
}

export interface VisualScenarioConfig {
  id?: string;
  label?: string;
  seed?: number;
  lighting?: ScenarioLightingPreset;
  environment?: string;
  camera?: ScenarioCameraConfig;
  materials?: ScenarioMaterialConfig;
  splat?: SplatScenarioConfig | null;
}

export interface ScenarioLightingProps {
  preset?: ScenarioLightingPreset;
  intensity?: number;
  castShadow?: boolean;
}

export interface SplatEnvironmentProps extends Omit<ThreeElements['group'], 'ref'> {
  environment?: PairedSplatEnvironmentConfig;
  scenario?: VisualScenarioConfig;
  renderer?: SplatRendererKind;
  src?: string;
  format?: SplatFormat;
  collisionProxy?: ReactNode;
  collisionProxyMetadata?: SplatCollisionProxyConfig;
  showPlaceholder?: boolean;
}

export interface VisualScenarioEffectsProps {
  scenario?: VisualScenarioConfig;
  enabled?: boolean;
  applyBackground?: boolean;
  applyFog?: boolean;
  applyRenderer?: boolean;
  applyMaterials?: boolean;
  background?: THREE.ColorRepresentation;
  fogNear?: number;
  fogFar?: number;
  materialFilter?: (input: VisualScenarioMaterialFilterInput) => boolean;
}

export interface VisualScenarioMaterialFilterInput {
  object: THREE.Object3D;
  material: THREE.Material;
}

export type TrajectoryInput = TrajectoryFrame[] | number[][];

export interface TrajectoryPlayerProps {
  trajectory: TrajectoryInput;
  fps?: number;
  speed?: number;
  loop?: boolean;
  playing?: boolean;
  mode?: 'kinematic' | 'physics';
  onFrame?: (input: TrajectoryFrameCallbackInput) => void;
  onComplete?: () => void;
  onStateChange?: (input: TrajectoryStateChangeInput) => void;
}

export interface TrajectoryFrameCallbackInput {
  frameIndex: number;
  frame: TrajectoryFrame | number[] | undefined;
}

export interface TrajectoryStateChangeInput {
  state: PlaybackState;
}

export interface SelectionHighlightProps {
  bodyId: number | null;
  color?: string;
  emissiveIntensity?: number;
}

export interface ContactListenerProps {
  body: Bodies;
  onContactEnter?: (info: ContactInfo) => void;
  onContactExit?: (info: ContactInfo) => void;
}

export interface BodyProps {
  name: Bodies;
  type: 'box' | 'sphere' | 'cylinder';
  size: [number, number, number];
  position?: [number, number, number];
  rgba?: [number, number, number, number];
  mass?: number;
  freejoint?: boolean;
  friction?: string;
  solref?: string;
  solimp?: string;
  condim?: number;
  /** MuJoCo geom group. Group 3 is conventionally used for collision-only helper geoms. */
  group?: number;
  children?: ReactNode;
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
  applyKeyframe(nameOrIndex: Keyframes | number): void;

  // State management (spec 4.1, 4.2, 4.3)
  saveState(): StateSnapshot;
  restoreState(snapshot: StateSnapshot): void;
  setQpos(values: Float64Array | number[]): void;
  setQvel(values: Float64Array | number[]): void;
  getQpos(): Float64Array;
  getQvel(): Float64Array;

  // Actuator / control (spec 3.1)
  setCtrl(nameOrValues: Actuators | Record<Actuators, number>, value?: number): void;
  getCtrl(): Float64Array;
  getControlMap(): ControlGroupInfo;
  getActuatedJoints(): ActuatedJointInfo[];
  resolveControlGroup(selector: ControlGroupSelector): ControlGroupInfo | null;

  // Force application (spec 8.1)
  applyForce(bodyName: Bodies, force: THREE.Vector3, point?: THREE.Vector3): void;
  applyTorque(bodyName: Bodies, torque: THREE.Vector3): void;
  setExternalForce(bodyName: Bodies, force: THREE.Vector3, torque: THREE.Vector3): void;
  applyGeneralizedForce(values: Float64Array | number[]): void;

  // Sensors (spec 2.1)
  getSensorData(name: Sensors): Float64Array | null;

  // Contacts (spec 2.4)
  getContacts(): ContactInfo[];

  // Model introspection (spec 5.1, 5.2)
  getBodies(): BodyInfo[];
  getJoints(): JointInfo[];
  getGeoms(): GeomInfo[];
  getSites(): SiteInfo[];
  getActuators(): ActuatorInfo[];
  getSensors(): SensorInfo[];
  getCameras(): CameraInfo[];

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
  loadFromFiles(files: FileList | readonly LocalMujocoFile[], options?: LoadFromFilesOptions): Promise<void>;
  addBody(body: SceneObject): Promise<void>;
  removeBody(name: Bodies): Promise<void>;
  recompile(patches?: XmlPatch[]): Promise<void>;

  // Canvas
  getCanvas(): HTMLCanvasElement | null;
  getCanvasSnapshot(width?: number, height?: number, mimeType?: string): string;
  captureFrame(options?: MujocoFrameCaptureOptions): Promise<FrameCaptureResult>;
  captureFrameBlob(options?: MujocoFrameCaptureOptions): Promise<FrameCaptureBlobResult>;
  captureCameraFrame(options?: CameraFrameCaptureOptions): Promise<CameraFrameCaptureResult>;
  captureCameraFrameBlob(options?: CameraFrameCaptureOptions): Promise<CameraFrameCaptureBlobResult>;
  recordCameraSequence(options: CameraFrameSequenceOptions): Promise<CameraFrameSequenceResult>;
  project2DTo3D(
    x: number,
    y: number,
    cameraPos: THREE.Vector3,
    lookAt: THREE.Vector3
  ): { point: THREE.Vector3; bodyId: number; geomId: number } | null;

  // Domain randomization (spec 10.3)
  setBodyMass(name: Bodies, mass: number): void;
  setGeomFriction(name: Geoms, friction: [number, number, number]): void;
  setGeomSize(name: Geoms, size: [number, number, number]): void;

  // Internal refs for advanced use
  readonly mjModelRef: React.RefObject<MujocoModel | null>;
  readonly mjDataRef: React.RefObject<MujocoData | null>;
}

export type FrameCaptureStatus = 'idle' | 'capturing' | 'captured' | 'error';

export type FrameCaptureTarget =
  | HTMLCanvasElement
  | HTMLElement
  | null
  | undefined;

export type FrameCaptureTargetRef =
  React.RefObject<HTMLCanvasElement | HTMLElement | null>;

export interface FrameCaptureOptions {
  target?: FrameCaptureTarget | FrameCaptureTargetRef;
  type?: string;
  quality?: number;
  waitForAnimationFrame?: boolean;
}

export type MujocoFrameCaptureOptions = Omit<FrameCaptureOptions, 'target'>;

export interface FrameCaptureResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  type: string;
}

export interface FrameCaptureBlobResult {
  canvas: HTMLCanvasElement;
  blob: Blob;
  type: string;
}

export interface FrameCaptureAPI {
  status: FrameCaptureStatus;
  error: Error | null;
  isCapturing: boolean;
  capture: (options?: FrameCaptureOptions) => Promise<FrameCaptureResult>;
  captureBlob: (
    options?: FrameCaptureOptions
  ) => Promise<FrameCaptureBlobResult>;
  reset: () => void;
}

export type CameraFrameCaptureVector3 =
  | THREE.Vector3
  | readonly [number, number, number];

export type CameraFrameCaptureQuaternion =
  | THREE.Quaternion
  | readonly [number, number, number, number];

export interface CameraFrameCaptureOptions {
  /** Existing Three camera to clone before applying pose overrides. */
  camera?: THREE.Camera;
  /** Named MuJoCo `<camera>` to render from when available in the loaded model. */
  cameraName?: Cameras;
  /** Named MuJoCo site to use as the rendered camera pose. Useful for robot-mounted optical frames. */
  siteName?: Sites;
  /** Named MuJoCo body to use as the rendered camera pose. */
  bodyName?: Bodies;
  position?: CameraFrameCaptureVector3;
  lookAt?: CameraFrameCaptureVector3;
  quaternion?: CameraFrameCaptureQuaternion;
  up?: CameraFrameCaptureVector3;
  width?: number;
  height?: number;
  type?: string;
  quality?: number;
  fov?: number;
  near?: number;
  far?: number;
  /** Provenance for the camera pose used by the capture. Usually set by the MuJoCo provider. */
  source?: CameraFrameCaptureSource;
}

export type CameraFrameCaptureSource =
  | { kind: 'mujoco-camera'; cameraName: Cameras }
  | { kind: 'mujoco-site'; siteName: Sites }
  | { kind: 'mujoco-body'; bodyName: Bodies }
  | { kind: 'custom-camera' }
  | { kind: 'explicit-pose' }
  | { kind: 'fallback-camera' };

export interface CameraFrameCaptureResult {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  dataUrl: string;
  type: string;
  width: number;
  height: number;
  source: CameraFrameCaptureSource;
}

export interface CameraFrameCaptureBlobResult {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  blob: Blob;
  type: string;
  width: number;
  height: number;
  source: CameraFrameCaptureSource;
}

export interface CameraFrameCaptureAPI {
  status: FrameCaptureStatus;
  error: Error | null;
  isCapturing: boolean;
  capture: (
    options?: CameraFrameCaptureOptions
  ) => Promise<CameraFrameCaptureResult>;
  captureBlob: (
    options?: CameraFrameCaptureOptions
  ) => Promise<CameraFrameCaptureBlobResult>;
  reset: () => void;
}

export interface CameraFrameSequenceCamera extends CameraFrameCaptureOptions {
  key: string;
}

export interface CameraFrameSequenceFrame {
  frameIndex: number;
  time: number;
  cameras: Record<string, CameraFrameCaptureResult>;
}

export interface CameraFrameSequenceCameraSummary {
  key: string;
  width: number;
  height: number;
  source: CameraFrameCaptureSource;
  frameCount: number;
  firstFrameIndex: number | null;
  lastFrameIndex: number | null;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

export interface CameraFrameSequenceSampleInput extends PhysicsStepInput {
  frameIndex: number;
  time: number;
}

export interface CameraFrameSequenceStepInput extends PhysicsStepInput {
  frameIndex: number;
  stepIndex: number;
  time: number;
}

export interface CameraFrameSequenceOptions {
  cameras: readonly CameraFrameSequenceCamera[];
  frames: number;
  /** Number of MuJoCo steps between captured frames. Use 0 for static camera provenance captures. */
  stepsPerFrame?: number;
  reset?: boolean;
  captureInitialFrame?: boolean;
  retainFrames?: boolean;
  /**
   * Require each recorded stream to resolve from exactly one mounted MuJoCo
   * camera/site/body selector. Defaults to true because sequence recording is
   * intended for dataset/policy camera streams.
   */
  requireMountedSources?: boolean;
  signal?: AbortSignal;
  /** Called after stepping and before image capture for this frame. Use this to record synchronized state/action rows. */
  onSample?: (input: CameraFrameSequenceSampleInput) => void | Promise<void>;
  /** Called before each MuJoCo step inside sequence recording. Use this to apply policy/control actions. */
  onBeforeStep?: (input: CameraFrameSequenceStepInput) => void | Promise<void>;
  /** Called after each MuJoCo step inside sequence recording. Use this for step-level telemetry. */
  onAfterStep?: (input: CameraFrameSequenceStepInput) => void | Promise<void>;
  onFrame?: (frame: CameraFrameSequenceFrame) => void | Promise<void>;
}

export interface CameraFrameSequenceResult {
  frames: CameraFrameSequenceFrame[];
  cameraKeys: string[];
  cameraSummaries: Record<string, CameraFrameSequenceCameraSummary>;
  frameCount: number;
}

export interface CameraFrameSequenceRecorderAPI {
  status: FrameCaptureStatus;
  error: Error | null;
  isRecording: boolean;
  record: (options: CameraFrameSequenceOptions) => Promise<CameraFrameSequenceResult>;
  reset: () => void;
}

// ---- Canvas Props ----

export type MujocoCanvasProps = Omit<CanvasProps, 'onError'> & {
  config: SceneConfig;
  /** R3F content rendered while the MuJoCo WASM module is still loading. */
  loadingFallback?: ReactNode;
  onReady?: (input: ReadyCallbackInput) => void;
  onError?: (error: Error) => void;
  onStep?: (input: StepCallbackInput) => void;
  onSelection?: (input: SelectionCallbackInput) => void;
  // Declarative physics config (spec 1.1)
  gravity?: [number, number, number];
  timestep?: number;
  substeps?: number;
  paused?: boolean;
  speed?: number;
  interpolate?: boolean;
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

/** @deprecated Use `SensorHandle` instead. */
export interface SensorResult {
  value: React.RefObject<Float64Array>;
  size: number;
}

export interface CtrlHandle {
  /** Read the current ctrl value. */
  read(): number;
  /** Write a ctrl value (goes directly to data.ctrl). */
  write(value: number): void;
  /** Actuator name. */
  name: Actuators;
  /** Actuator control range [min, max]. */
  range: [number, number];
}

export interface SensorHandle {
  /** Read the current sensor data. */
  read(): Float64Array;
  /** Sensor dimensionality. */
  dim: number;
  /** Sensor name. */
  name: Sensors;
}

export interface BodyStateResult {
  position: React.RefObject<THREE.Vector3>;
  quaternion: React.RefObject<THREE.Quaternion>;
  linearVelocity: React.RefObject<THREE.Vector3>;
  angularVelocity: React.RefObject<THREE.Vector3>;
}

export type JointStateKind = 'auto' | 'scalar' | 'array';

export interface JointStateOptions {
  /**
   * Expected joint value shape.
   *
   * - `auto`: scalar joints return numbers, ball/free joints return Float64Array.
   * - `scalar`: return numeric refs for hinge/slide joints.
   * - `array`: return Float64Array refs for ball/free joints.
   */
  kind?: JointStateKind;
}

export interface JointStateResult {
  position: React.RefObject<number | Float64Array>;
  velocity: React.RefObject<number | Float64Array>;
}

export interface ScalarJointStateResult {
  position: React.RefObject<number>;
  velocity: React.RefObject<number>;
}

export interface ArrayJointStateResult {
  position: React.RefObject<Float64Array>;
  velocity: React.RefObject<Float64Array>;
}
