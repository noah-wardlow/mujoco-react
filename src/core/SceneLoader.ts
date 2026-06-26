/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ActuatedJointInfo,
  ActuatorInfo,
  ControlGroupInfo,
  ControlGroupSelector,
  ControlJointInfo,
  JointInfo,
  LoadFromFilesOptions,
  LocalMujocoFile,
  MujocoData,
  MujocoModel,
  MujocoModule,
  ResourceSelector,
} from '../types';
import { SceneConfig, SceneObject, XmlPatch } from '../types';

const JOINT_TYPE_NAMES: Record<number, string> = {
  0: 'free',
  1: 'ball',
  2: 'slide',
  3: 'hinge',
};

/**
 * Reads a null-terminated C string from MuJoCo's WASM memory.
 */
export function getName(mjModel: MujocoModel, address: number): string {
  let name = '';
  let idx = address;
  let safety = 0;
  while (mjModel.names[idx] !== 0 && safety < 100) {
    name += String.fromCharCode(mjModel.names[idx++]);
    safety++;
  }
  return name;
}

/**
 * Find a site by name in the MuJoCo model. Returns -1 if not found.
 */
export function findSiteByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < mjModel.nsite; i++) {
    if (getName(mjModel, mjModel.name_siteadr[i]).includes(name)) return i;
  }
  return -1;
}

/**
 * Find an actuator by name in the MuJoCo model. Returns -1 if not found.
 */
export function findActuatorByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < mjModel.nu; i++) {
    if (getName(mjModel, mjModel.name_actuatoradr[i]).includes(name)) return i;
  }
  return -1;
}

/**
 * Find a keyframe by name in the MuJoCo model. Returns -1 if not found.
 */
export function findKeyframeByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < mjModel.nkey; i++) {
    if (getName(mjModel, mjModel.name_keyadr[i]) === name) return i;
  }
  return -1;
}

/**
 * Find a body by name in the MuJoCo model. Returns -1 if not found.
 */
export function findBodyByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < mjModel.nbody; i++) {
    if (getName(mjModel, mjModel.name_bodyadr[i]) === name) return i;
  }
  return -1;
}

/**
 * Find a joint by name in the MuJoCo model. Returns -1 if not found.
 */
export function findJointByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < mjModel.njnt; i++) {
    if (getName(mjModel, mjModel.name_jntadr[i]) === name) return i;
  }
  return -1;
}

/**
 * Find a geom by name in the MuJoCo model. Returns -1 if not found.
 */
export function findGeomByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < mjModel.ngeom; i++) {
    if (getName(mjModel, mjModel.name_geomadr[i]) === name) return i;
  }
  return -1;
}

/**
 * Find a sensor by name in the MuJoCo model. Returns -1 if not found.
 */
export function findSensorByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < mjModel.nsensor; i++) {
    if (getName(mjModel, mjModel.name_sensoradr[i]) === name) return i;
  }
  return -1;
}

/**
 * Find a camera by name in the MuJoCo model. Returns -1 if not found.
 */
export function findCameraByName(mjModel: MujocoModel, name: string): number {
  const ncam = mjModel.ncam ?? 0;
  const addresses = mjModel.name_camadr;
  if (!addresses) return -1;
  for (let i = 0; i < ncam; i++) {
    if (getName(mjModel, addresses[i]) === name) return i;
  }
  return -1;
}

/**
 * Find a tendon by name in the MuJoCo model. Returns -1 if not found.
 */
export function findTendonByName(mjModel: MujocoModel, name: string): number {
  for (let i = 0; i < (mjModel.ntendon ?? 0); i++) {
    if (getName(mjModel, mjModel.name_tendonadr[i]) === name) return i;
  }
  return -1;
}

/**
 * Return qpos address for actuators that directly target a scalar joint.
 * Returns -1 for non-joint transmissions and multi-DOF joints.
 */
export function getActuatedScalarQposAdr(mjModel: MujocoModel, actuatorId: number): number {
  if (actuatorId < 0 || actuatorId >= mjModel.nu) return -1;

  // mjTRN_JOINT=0, mjTRN_JOINTINPARENT=1. Other transmission types don't map ctrl to a single qpos.
  const trnType = mjModel.actuator_trntype?.[actuatorId];
  if (trnType !== undefined && trnType !== 0 && trnType !== 1) return -1;

  const jointId = mjModel.actuator_trnid[2 * actuatorId];
  if (jointId < 0 || jointId >= mjModel.njnt) return -1;

  const jntType = mjModel.jnt_type[jointId];
  if (jntType !== 2 && jntType !== 3) return -1; // slide=2, hinge=3

  return mjModel.jnt_qposadr[jointId];
}

function getScalarJointDim(jointType: number): 0 | 1 {
  return jointType === 2 || jointType === 3 ? 1 : 0;
}

function unlimitedRange(): [number, number] {
  return [-Infinity, Infinity];
}

function isScalarJoint(mjModel: MujocoModel, jointId: number): boolean {
  return jointId >= 0 && jointId < mjModel.njnt && getScalarJointDim(mjModel.jnt_type[jointId]) === 1;
}

function getActuatorJointId(mjModel: MujocoModel, actuatorId: number): number {
  if (actuatorId < 0 || actuatorId >= mjModel.nu) return -1;
  const trnType = mjModel.actuator_trntype?.[actuatorId];
  if (trnType !== undefined && trnType !== 0 && trnType !== 1) return -1;
  const jointId = mjModel.actuator_trnid[2 * actuatorId];
  return isScalarJoint(mjModel, jointId) ? jointId : -1;
}

function getJointInfo(mjModel: MujocoModel, jointId: number): JointInfo {
  const type = mjModel.jnt_type[jointId];
  const range: [number, number] = [mjModel.jnt_range[2 * jointId], mjModel.jnt_range[2 * jointId + 1]];
  return {
    id: jointId,
    name: getName(mjModel, mjModel.name_jntadr[jointId]),
    type,
    typeName: JOINT_TYPE_NAMES[type] ?? `unknown(${type})`,
    range,
    limited: range[0] < range[1],
    bodyId: mjModel.jnt_bodyid[jointId],
    qposAdr: mjModel.jnt_qposadr[jointId],
    dofAdr: mjModel.jnt_dofadr[jointId],
  };
}

function getActuatorInfo(mjModel: MujocoModel, actuatorId: number): ActuatorInfo {
  const hasRange = mjModel.actuator_ctrlrange[2 * actuatorId] < mjModel.actuator_ctrlrange[2 * actuatorId + 1];
  return {
    id: actuatorId,
    name: getName(mjModel, mjModel.name_actuatoradr[actuatorId]),
    range: hasRange
      ? [mjModel.actuator_ctrlrange[2 * actuatorId], mjModel.actuator_ctrlrange[2 * actuatorId + 1]]
      : unlimitedRange(),
  };
}

function includesResourceName(names: readonly string[], name: string): boolean {
  return names.includes(name);
}

function matchesSelector<TInfo extends { name: string }, TName extends string>(
  info: TInfo,
  selector: ResourceSelector<TInfo, TName>
): boolean {
  if (typeof selector === 'string') return info.name === selector;
  if (selector instanceof RegExp) return selector.test(info.name);
  if (Array.isArray(selector)) return includesResourceName(selector, info.name);
  if (typeof selector === 'function') return selector(info);
  return false;
}

function orderedJointIdsFromSelector(
  mjModel: MujocoModel,
  selector: ResourceSelector<JointInfo, string>
): number[] {
  if (typeof selector === 'string') {
    const id = findJointByName(mjModel, selector);
    return id >= 0 && isScalarJoint(mjModel, id) ? [id] : [];
  }
  if (Array.isArray(selector)) {
    return selector
      .map((name) => findJointByName(mjModel, name))
      .filter((id) => id >= 0 && isScalarJoint(mjModel, id));
  }
  const ids: number[] = [];
  for (let i = 0; i < mjModel.njnt; i++) {
    if (!isScalarJoint(mjModel, i)) continue;
    const info = getJointInfo(mjModel, i);
    if (matchesSelector(info, selector)) ids.push(i);
  }
  return ids;
}

function orderedActuatorIdsFromSelector(
  mjModel: MujocoModel,
  selector: ResourceSelector<ActuatorInfo, string>
): number[] {
  if (typeof selector === 'string') {
    const id = findActuatorByName(mjModel, selector);
    return id >= 0 && getActuatorJointId(mjModel, id) >= 0 ? [id] : [];
  }
  if (Array.isArray(selector)) {
    return selector
      .map((name) => findActuatorByName(mjModel, name))
      .filter((id) => id >= 0 && getActuatorJointId(mjModel, id) >= 0);
  }
  const ids: number[] = [];
  for (let i = 0; i < mjModel.nu; i++) {
    if (getActuatorJointId(mjModel, i) < 0) continue;
    const info = getActuatorInfo(mjModel, i);
    if (matchesSelector(info, selector)) ids.push(i);
  }
  return ids;
}

function inferScalarJointChain(mjModel: MujocoModel, bodyId: number): number[] {
  if (bodyId < 0 || bodyId >= mjModel.nbody) return [];
  const chainByBody: number[][] = [];
  let current = bodyId;
  const seen = new Set<number>();

  while (current >= 0 && current < mjModel.nbody && !seen.has(current)) {
    seen.add(current);
    const joints: number[] = [];
    const jointCount = mjModel.body_jntnum[current] ?? 0;
    const jointStart = mjModel.body_jntadr[current] ?? -1;
    for (let i = 0; i < jointCount; i++) {
      const jointId = jointStart + i;
      if (isScalarJoint(mjModel, jointId)) joints.push(jointId);
    }
    if (joints.length) chainByBody.push(joints);
    const parent = mjModel.body_parentid[current];
    if (parent === current) break;
    current = parent;
  }

  return chainByBody.reverse().flat();
}

function unique(values: number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function findActuatorForJoint(mjModel: MujocoModel, jointId: number, preferredActuatorIds?: number[]): number {
  const search = preferredActuatorIds ?? Array.from({ length: mjModel.nu }, (_, i) => i);
  for (const actuatorId of search) {
    if (getActuatorJointId(mjModel, actuatorId) === jointId) return actuatorId;
  }
  return -1;
}

function buildControlGroup(
  mjModel: MujocoModel,
  jointIds: number[],
  preferredActuatorIds?: number[]
): ControlGroupInfo | null {
  const ids = unique(jointIds).filter((id) => isScalarJoint(mjModel, id));
  if (!ids.length) return null;

  const joints: ControlJointInfo[] = [];
  const actuators: ActuatorInfo[] = [];
  const qposAdr: number[] = [];
  const dofAdr: number[] = [];
  const ctrlAdr: number[] = [];

  for (const jointId of ids) {
    const actuatorId = findActuatorForJoint(mjModel, jointId, preferredActuatorIds);
    const joint = getJointInfo(mjModel, jointId);
    qposAdr.push(joint.qposAdr);
    dofAdr.push(joint.dofAdr);

    if (actuatorId >= 0) {
      const actuator = getActuatorInfo(mjModel, actuatorId);
      actuators.push(actuator);
      ctrlAdr.push(actuatorId);
      joints.push({
        ...joint,
        actuatorId,
        actuatorName: actuator.name,
        ctrlAdr: actuatorId,
        ctrlRange: actuator.range,
      });
    } else {
      joints.push({
        ...joint,
        actuatorId: null,
        actuatorName: null,
        ctrlAdr: null,
        ctrlRange: null,
      });
    }
  }

  return {
    joints,
    actuators,
    qposAdr,
    dofAdr,
    ctrlAdr,
    readQpos(data: MujocoData) {
      return new Float64Array(qposAdr.map((adr) => data.qpos[adr] ?? 0));
    },
    readCtrl(data: MujocoData) {
      return new Float64Array(joints.map((joint) => joint.ctrlAdr === null ? 0 : data.ctrl[joint.ctrlAdr] ?? 0));
    },
    writeQpos(data: MujocoData, values: ArrayLike<number>) {
      for (let i = 0; i < Math.min(values.length, qposAdr.length); i++) {
        data.qpos[qposAdr[i]] = values[i];
      }
    },
    writeCtrl(data: MujocoData, values: ArrayLike<number>) {
      for (let i = 0; i < Math.min(values.length, joints.length); i++) {
        const adr = joints[i].ctrlAdr;
        if (adr !== null) data.ctrl[adr] = values[i];
      }
    },
  };
}

export function getActuatedJoints(mjModel: MujocoModel): ActuatedJointInfo[] {
  const result: ActuatedJointInfo[] = [];
  for (let actuatorId = 0; actuatorId < mjModel.nu; actuatorId++) {
    const jointId = getActuatorJointId(mjModel, actuatorId);
    if (jointId < 0) continue;
    const actuator = getActuatorInfo(mjModel, actuatorId);
    result.push({
      ...getJointInfo(mjModel, jointId),
      actuatorId,
      actuatorName: actuator.name,
      ctrlAdr: actuatorId,
      ctrlRange: actuator.range,
    });
  }
  return result;
}

export function getControlMap(mjModel: MujocoModel): ControlGroupInfo {
  const actuatorIds = Array.from({ length: mjModel.nu }, (_, i) => i)
    .filter((id) => getActuatorJointId(mjModel, id) >= 0);
  const jointIds = actuatorIds.map((id) => getActuatorJointId(mjModel, id));
  return buildControlGroup(mjModel, jointIds, actuatorIds) ?? createContiguousControlGroup(mjModel, 0);
}

export function resolveControlGroup(
  mjModel: MujocoModel,
  selector: ControlGroupSelector
): ControlGroupInfo | null {
  if (selector.actuators) {
    const actuatorIds = orderedActuatorIdsFromSelector(mjModel, selector.actuators);
    const jointIds = actuatorIds.map((id) => getActuatorJointId(mjModel, id));
    return buildControlGroup(mjModel, jointIds, actuatorIds);
  }

  if (selector.joints) {
    return buildControlGroup(mjModel, orderedJointIdsFromSelector(mjModel, selector.joints));
  }

  if (selector.siteName) {
    const siteId = findSiteByName(mjModel, selector.siteName);
    const bodyId = siteId >= 0 ? (mjModel.site_bodyid?.[siteId] ?? -1) : -1;
    return buildControlGroup(mjModel, inferScalarJointChain(mjModel, bodyId));
  }

  if (selector.bodyName) {
    return buildControlGroup(mjModel, inferScalarJointChain(mjModel, findBodyByName(mjModel, selector.bodyName)));
  }

  return getControlMap(mjModel);
}

export function createContiguousControlGroup(mjModel: MujocoModel, count: number): ControlGroupInfo {
  const n = Math.max(0, Math.min(count, mjModel.nq, mjModel.nu));
  const joints: ControlJointInfo[] = [];
  const actuators: ActuatorInfo[] = [];
  const qposAdr: number[] = [];
  const dofAdr: number[] = [];
  const ctrlAdr: number[] = [];

  for (let i = 0; i < n; i++) {
    qposAdr.push(i);
    dofAdr.push(i);
    ctrlAdr.push(i);
    const jointId = Array.from({ length: mjModel.njnt }, (_, id) => id)
      .find((id) => mjModel.jnt_qposadr[id] === i);
    const actuator = getActuatorInfo(mjModel, i);
    actuators.push(actuator);
    joints.push({
      ...(jointId !== undefined ? getJointInfo(mjModel, jointId) : {
        id: i,
        name: `qpos${i}`,
        type: 3,
        typeName: 'hinge',
        range: unlimitedRange(),
        limited: false,
        bodyId: -1,
        qposAdr: i,
        dofAdr: i,
      }),
      actuatorId: i,
      actuatorName: actuator.name,
      ctrlAdr: i,
      ctrlRange: actuator.range,
    });
  }

  return {
    joints,
    actuators,
    qposAdr,
    dofAdr,
    ctrlAdr,
    readQpos(data: MujocoData) {
      return new Float64Array(qposAdr.map((adr) => data.qpos[adr] ?? 0));
    },
    readCtrl(data: MujocoData) {
      return new Float64Array(ctrlAdr.map((adr) => data.ctrl[adr] ?? 0));
    },
    writeQpos(data: MujocoData, values: ArrayLike<number>) {
      for (let i = 0; i < Math.min(values.length, qposAdr.length); i++) data.qpos[qposAdr[i]] = values[i];
    },
    writeCtrl(data: MujocoData, values: ArrayLike<number>) {
      for (let i = 0; i < Math.min(values.length, ctrlAdr.length); i++) data.ctrl[ctrlAdr[i]] = values[i];
    },
  };
}

/**
 * Convert a SceneObject config to MuJoCo XML.
 */
function sceneObjectToXml(obj: SceneObject): string {
  const joint = obj.freejoint ? '<freejoint/>' : '';
  const geomName = obj.geomName ?? `${obj.name}_geom`;
  const pos = obj.position.map((v) => v.toFixed(3)).join(' ');
  const sizeValues = obj.type === 'sphere'
    ? obj.size.slice(0, 1)
    : obj.type === 'cylinder'
      ? obj.size.slice(0, 2)
      : obj.size;
  const size = sizeValues.map((v) => v.toFixed(3)).join(' ');
  const rgba = obj.rgba.join(' ');
  const mass = obj.mass ? ` mass="${obj.mass}"` : '';
  const friction = obj.friction ? ` friction="${obj.friction}"` : '';
  const solref = obj.solref ? ` solref="${obj.solref}"` : '';
  const solimp = obj.solimp ? ` solimp="${obj.solimp}"` : '';
  const condim = obj.condim ? ` condim="${obj.condim}"` : '';
  const contype = obj.contype ?? 1;
  const conaffinity = obj.conaffinity ?? 1;
  const group = obj.group !== undefined ? ` group="${obj.group}"` : '';
  return `<body name="${obj.name}" pos="${pos}">${joint}<geom name="${geomName}" type="${obj.type}" size="${size}" rgba="${rgba}" contype="${contype}" conaffinity="${conaffinity}"${mass}${friction}${solref}${solimp}${condim}${group}/></body>`;
}

/** Create virtual directory structure for a file path. */
function ensureDir(mujoco: MujocoModule, fname: string) {
  const dirParts = fname.split('/');
  dirParts.pop();
  let currentPath = '/working';
  for (const part of dirParts) {
    currentPath += '/' + part;
    try { mujoco.FS.mkdir(currentPath); } catch { /* ignore */ }
  }
}

interface LoadResult {
  mjModel: MujocoModel;
  mjData: MujocoData;
}

function loadModelFromPath(mujoco: MujocoModule, path: string): MujocoModel {
  if (mujoco.MjModel.from_xml_path) {
    return mujoco.MjModel.from_xml_path(path);
  }
  if (mujoco.MjModel.loadFromXML) {
    return mujoco.MjModel.loadFromXML(path);
  }
  throw new Error('MuJoCo WASM module does not expose an XML path loader');
}

function isModelTextFile(fname: string): boolean {
  const lower = fname.toLowerCase();
  return lower.endsWith('.xml') || lower.endsWith('.urdf') || lower.endsWith('.mjcf');
}

function normalizeVfsPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const norm: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') norm.pop();
    else norm.push(part);
  }
  return norm.join('/');
}

function localFilePath(file: LocalMujocoFile): string {
  return normalizeVfsPath(file.webkitRelativePath || file.name);
}

function dirname(path: string): string {
  const normalized = normalizeVfsPath(path);
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? '' : normalized.slice(0, idx + 1);
}

function relativeVfsPath(fromDir: string, targetPath: string): string {
  const from = normalizeVfsPath(fromDir).split('/').filter(Boolean);
  const target = normalizeVfsPath(targetPath).split('/').filter(Boolean);
  while (from.length && target.length && from[0] === target[0]) {
    from.shift();
    target.shift();
  }
  return [...from.map(() => '..'), ...target].join('/') || '.';
}

function inferSceneFile(files: readonly LocalMujocoFile[], options?: LoadFromFilesOptions): string {
  if (options?.sceneFile) return normalizeVfsPath(options.sceneFile);

  const paths = files.map(localFilePath);
  const preferred = ['scene.xml', 'model.xml', 'robot.xml', 'scene.urdf', 'model.urdf', 'robot.urdf'];
  for (const name of preferred) {
    const match = paths.find((path) => path.endsWith(name));
    if (match) return match;
  }

  const firstModel = paths.find(isModelTextFile);
  if (!firstModel) throw new Error('No MJCF XML or URDF file found in FileList');
  return firstModel;
}

export function createSceneConfigFromFiles(
  files: FileList | readonly LocalMujocoFile[],
  options: LoadFromFilesOptions = {}
): SceneConfig {
  const fileArray = Array.from(files) as LocalMujocoFile[];
  return {
    src: '',
    sceneFile: inferSceneFile(fileArray, options),
    files: fileArray,
    environmentFiles: options.environmentFiles?.map(normalizeVfsPath),
    homeJoints: options.homeJoints,
    xmlPatches: options.xmlPatches,
    sceneObjects: options.sceneObjects,
    onReset: options.onReset,
  };
}

const ENVIRONMENT_MERGE_SECTIONS = [
  'asset',
  'worldbody',
  'contact',
  'equality',
  'tendon',
  'sensor',
  'keyframe',
  'custom',
  'extension',
] as const;

function directChild(parent: Element, tagName: string): Element | null {
  const lower = tagName.toLowerCase();
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === lower) return child;
  }
  return null;
}

function ensureTopLevelSection(doc: XMLDocument, tagName: string): Element {
  const root = doc.documentElement;
  const existing = directChild(root, tagName);
  if (existing) return existing;

  const section = doc.createElement(tagName);
  if (tagName === 'asset') {
    const worldbody = directChild(root, 'worldbody');
    if (worldbody) root.insertBefore(section, worldbody);
    else root.appendChild(section);
  } else {
    root.appendChild(section);
  }
  return section;
}

function readCompilerDirs(doc: XMLDocument) {
  const compiler = directChild(doc.documentElement, 'compiler');
  const assetDir = compiler?.getAttribute('assetdir') || '';
  return {
    meshDir: compiler?.getAttribute('meshdir') || assetDir,
    textureDir: compiler?.getAttribute('texturedir') || assetDir,
  };
}

function isExternalPath(path: string): boolean {
  return /^[a-z]+:\/\//i.test(path) || path.startsWith('package://') || path.startsWith('/');
}

function fileReferencePrefix(el: Element, compilerDirs: ReturnType<typeof readCompilerDirs>): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'mesh') return compilerDirs.meshDir ? compilerDirs.meshDir + '/' : '';
  if (tag === 'texture' || tag === 'hfield') return compilerDirs.textureDir ? compilerDirs.textureDir + '/' : '';
  return '';
}

function rewriteFileReferencesForMerge(node: Element, sourceFile: string, targetFile: string, sourceDoc: XMLDocument) {
  const sourceDir = dirname(sourceFile);
  const targetDir = dirname(targetFile);
  const compilerDirs = readCompilerDirs(sourceDoc);
  node.querySelectorAll('[file], [filename]').forEach((el) => {
    const attr = el.hasAttribute('file') ? 'file' : 'filename';
    const value = el.getAttribute(attr);
    if (!value || isExternalPath(value)) return;

    const sourceRelativePath = normalizeVfsPath(fileReferencePrefix(el, compilerDirs) + value);
    const resolvedPath = normalizeVfsPath(sourceDir + sourceRelativePath);
    el.setAttribute(attr, relativeVfsPath(targetDir, resolvedPath));
  });
}

function hasParseError(doc: XMLDocument): boolean {
  return doc.getElementsByTagName('parsererror').length > 0;
}

function composeEnvironmentXml(
  sceneXml: string,
  config: SceneConfig,
  parser: DOMParser,
  environmentXmlByPath: Map<string, string>
): string {
  const environmentFiles = config.environmentFiles?.map(normalizeVfsPath) ?? [];
  if (!environmentFiles.length) return sceneXml;

  const sceneDoc = parser.parseFromString(sceneXml, 'text/xml');
  if (hasParseError(sceneDoc)) {
    console.warn(`Could not compose environments: failed to parse ${config.sceneFile}`);
    return sceneXml;
  }

  for (const environmentFile of environmentFiles) {
    const environmentXml = environmentXmlByPath.get(environmentFile);
    if (!environmentXml) {
      console.warn(`Environment XML not found: ${environmentFile}`);
      continue;
    }

    const environmentDoc = parser.parseFromString(environmentXml, 'text/xml');
    if (hasParseError(environmentDoc)) {
      console.warn(`Skipping environment XML with parse errors: ${environmentFile}`);
      continue;
    }

    for (const sectionName of ENVIRONMENT_MERGE_SECTIONS) {
      const environmentSection = directChild(environmentDoc.documentElement, sectionName);
      if (!environmentSection?.children.length) continue;

      const targetSection = ensureTopLevelSection(sceneDoc, sectionName);
      for (const child of Array.from(environmentSection.children)) {
        const imported = sceneDoc.importNode(child, true) as Element;
        rewriteFileReferencesForMerge(imported, environmentFile, config.sceneFile, environmentDoc);
        targetSection.appendChild(imported);
      }
    }
  }

  return new XMLSerializer().serializeToString(sceneDoc);
}

function findTextByConfiguredPath(textByPath: Map<string, string>, configuredPath: string): string | undefined {
  const normalized = normalizeVfsPath(configuredPath);
  const direct = textByPath.get(normalized);
  if (direct) return direct;

  const suffix = '/' + normalized;
  for (const [path, text] of textByPath) {
    if (path.endsWith(suffix) || path === normalized.split('/').pop()) return text;
  }
  return undefined;
}

function applyXmlPatches(text: string, fname: string, config: SceneConfig): string {
  let result = text;
  for (const patch of config.xmlPatches ?? []) {
    if (fname.endsWith(patch.target) || fname === patch.target) {
      if (patch.replace) {
        const [from, to] = patch.replace;
        if (result.includes(from)) {
          result = result.replace(from, to);
        } else {
          const preview = from.length > 80 ? `${from.slice(0, 80)}...` : from;
          console.warn(`XML patch replace pattern not found in ${fname}: "${preview}"`);
        }
      }
      if (patch.inject && patch.injectAfter) {
        const idx = result.indexOf(patch.injectAfter);
        if (idx !== -1) {
          const tagEnd = result.indexOf('>', idx + patch.injectAfter.length);
          if (tagEnd !== -1) {
            result = result.slice(0, tagEnd + 1) + patch.inject + result.slice(tagEnd + 1);
          } else {
            console.warn(`XML patch inject failed in ${fname}: could not find tag end after "${patch.injectAfter}"`);
          }
        } else {
          const preview = patch.injectAfter.length > 80
            ? `${patch.injectAfter.slice(0, 80)}...`
            : patch.injectAfter;
          console.warn(`XML patch inject anchor not found in ${fname}: "${preview}"`);
        }
      }
    }
  }

  if (fname === config.sceneFile && config.sceneObjects?.length && result.includes('</worldbody>')) {
    const xml = config.sceneObjects.map((obj) => sceneObjectToXml(obj)).join('');
    result = result.replace('</worldbody>', xml + '</worldbody>');
  }

  return result;
}

async function loadSceneFromFiles(
  mujoco: MujocoModule,
  config: SceneConfig,
  onProgress?: (msg: string) => void
): Promise<LoadResult> {
  const files = config.files ?? [];
  if (!files.length) throw new Error('loadFromFiles requires at least one File');

  try { mujoco.FS.unmount('/working'); } catch { /* ignore */ }
  try { mujoco.FS.mkdir('/working'); } catch { /* ignore */ }

  const parser = new DOMParser();
  const byPath = new Map<string, LocalMujocoFile>();
  const byBasename = new Map<string, LocalMujocoFile>();
  const written = new Set<string>();
  const textByPath = new Map<string, string>();

  for (const file of files) {
    const path = localFilePath(file);
    byPath.set(path, file);
    byBasename.set(path.split('/').pop() ?? path, file);
  }

  for (const [path, file] of byPath) {
    onProgress?.(`Reading ${path}...`);
    ensureDir(mujoco, path);
    if (isModelTextFile(path)) {
      const text = applyXmlPatches(await file.text(), path, config);
      textByPath.set(path, text);
    } else {
      mujoco.FS.writeFile(`/working/${path}`, new Uint8Array(await file.arrayBuffer()));
      written.add(path);
    }
  }

  const environmentXmlByPath = new Map<string, string>();
  for (const environmentFile of config.environmentFiles?.map(normalizeVfsPath) ?? []) {
    const environmentXml = findTextByConfiguredPath(textByPath, environmentFile);
    if (environmentXml) environmentXmlByPath.set(environmentFile, environmentXml);
  }

  for (const [path, text] of textByPath) {
    const composedText = path === config.sceneFile
      ? composeEnvironmentXml(text, config, parser, environmentXmlByPath)
      : text;
    textByPath.set(path, composedText);
    ensureDir(mujoco, path);
    mujoco.FS.writeFile(`/working/${path}`, composedText);
    written.add(path);
  }

  for (const [path, text] of textByPath) {
    const deps = collectDependencyPaths(text, path, parser);
    for (const dep of deps) {
      if (written.has(dep)) continue;
      const file = byPath.get(dep) ?? byBasename.get(dep.split('/').pop() ?? dep);
      if (!file) continue;
      ensureDir(mujoco, dep);
      if (isModelTextFile(dep)) {
        mujoco.FS.writeFile(`/working/${dep}`, applyXmlPatches(await file.text(), dep, config));
      } else {
        mujoco.FS.writeFile(`/working/${dep}`, new Uint8Array(await file.arrayBuffer()));
      }
      written.add(dep);
    }
  }

  onProgress?.('Loading model...');
  const mjModel = loadModelFromPath(mujoco, `/working/${config.sceneFile}`);
  const mjData = new mujoco.MjData(mjModel);
  applyInitialPose(mjModel, mjData, config);
  mujoco.mj_forward(mjModel, mjData);

  return { mjModel, mjData };
}

function applyInitialPose(mjModel: MujocoModel, mjData: MujocoData, config: SceneConfig) {
  if (!config.homeJoints) return;
  const homeCount = Math.min(config.homeJoints.length, Math.max(mjModel.nu, mjModel.nq));
  for (let i = 0; i < homeCount; i++) {
    if (i < mjModel.nu) mjData.ctrl[i] = config.homeJoints[i];
    if (i < mjModel.nq) {
      const qposAdr = i < mjModel.nu ? getActuatedScalarQposAdr(mjModel, i) : -1;
      mjData.qpos[qposAdr !== -1 ? qposAdr : i] = config.homeJoints[i];
    }
  }
}

/**
 * Config-driven scene loader — replaces the old single-model patching approach.
 */
export async function loadScene(
  mujoco: MujocoModule,
  config: SceneConfig,
  onProgress?: (msg: string) => void
): Promise<LoadResult> {
  if (config.files?.length) {
    return loadSceneFromFiles(mujoco, config, onProgress);
  }

  // 1. Clean up virtual filesystem
  try { mujoco.FS.unmount('/working'); } catch { /* ignore */ }
  try { mujoco.FS.mkdir('/working'); } catch { /* ignore */ }

  const baseUrl = config.src.endsWith('/') ? config.src : config.src + '/';

  const environmentXmlByPath = new Map<string, string>();
  const environmentFiles = config.environmentFiles?.map(normalizeVfsPath) ?? [];
  for (const environmentFile of environmentFiles) {
    onProgress?.(`Downloading ${environmentFile}...`);
    const res = await fetch(baseUrl + environmentFile);
    if (!res.ok) {
      console.warn(`Failed to fetch environment XML ${environmentFile}: ${res.status} ${res.statusText}`);
      continue;
    }
    environmentXmlByPath.set(environmentFile, applyXmlPatches(await res.text(), environmentFile, config));
  }

  const downloaded = new Set<string>();
  const xmlQueue: string[] = [config.sceneFile];
  const assetFiles: string[] = [];
  const parser = new DOMParser();

  // 2a. Download XML files sequentially (to discover dependencies)
  while (xmlQueue.length > 0) {
    const fname = xmlQueue.shift()!;
    if (downloaded.has(fname)) continue;
    downloaded.add(fname);

    if (!isModelTextFile(fname)) {
      // Non-XML discovered during XML scan — collect for parallel download
      assetFiles.push(fname);
      continue;
    }

    onProgress?.(`Downloading ${fname}...`);

    const res = await fetch(baseUrl + fname);
    if (!res.ok) {
      console.warn(`Failed to fetch ${fname}: ${res.status} ${res.statusText}`);
      continue;
    }

    const patchedText = applyXmlPatches(await res.text(), fname, config);
    const text = fname === config.sceneFile
      ? composeEnvironmentXml(patchedText, config, parser, environmentXmlByPath)
      : patchedText;

    ensureDir(mujoco, fname);
    mujoco.FS.writeFile(`/working/${fname}`, text);
    scanDependencies(text, fname, parser, downloaded, xmlQueue);
  }

  // 2b. Download all binary assets (meshes, textures) in parallel
  if (assetFiles.length > 0) {
    onProgress?.(`Downloading ${assetFiles.length} assets...`);

    const results = await Promise.all(
      assetFiles.map(async (fname) => {
        const res = await fetch(baseUrl + fname);
        if (!res.ok) {
          console.warn(`Failed to fetch ${fname}: ${res.status} ${res.statusText}`);
          return null;
        }
        return { fname, buffer: new Uint8Array(await res.arrayBuffer()) };
      })
    );

    for (const result of results) {
      if (!result) continue;
      ensureDir(mujoco, result.fname);
      mujoco.FS.writeFile(`/working/${result.fname}`, result.buffer);
    }
  }

  // 5. Load model
  onProgress?.('Loading model...');
  const mjModel = loadModelFromPath(mujoco, `/working/${config.sceneFile}`);
  const mjData = new mujoco.MjData(mjModel);

  // 6. Set initial pose — set both ctrl and qpos so robot starts at home.
  //    If homeJoints is not provided, keep raw MuJoCo defaults.
  applyInitialPose(mjModel, mjData, config);

  mujoco.mj_forward(mjModel, mjData);

  return { mjModel, mjData };
}

/**
 * Scan XML for file dependencies (meshes, textures, includes).
 */
function scanDependencies(
  xmlString: string,
  currentFile: string,
  parser: DOMParser,
  downloaded: Set<string>,
  queue: string[]
) {
  for (const fullPath of collectDependencyPaths(xmlString, currentFile, parser)) {
    if (!downloaded.has(fullPath)) queue.push(fullPath);
  }
}

function collectDependencyPaths(
  xmlString: string,
  currentFile: string,
  parser: DOMParser
): string[] {
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const compiler = xmlDoc.querySelector('compiler');
  const assetDir = compiler?.getAttribute('assetdir') || '';
  const meshDir = compiler?.getAttribute('meshdir') || assetDir;
  const textureDir = compiler?.getAttribute('texturedir') || assetDir;
  const currentDir = currentFile.includes('/')
    ? currentFile.substring(0, currentFile.lastIndexOf('/') + 1)
    : '';

  const paths: string[] = [];
  xmlDoc.querySelectorAll('[file], [filename]').forEach((el) => {
    const fileAttr = el.getAttribute('file') ?? el.getAttribute('filename');
    if (!fileAttr) return;
    if (/^[a-z]+:\/\//i.test(fileAttr) || fileAttr.startsWith('package://')) return;

    let prefix = '';
    if (el.tagName.toLowerCase() === 'mesh') {
      prefix = meshDir ? meshDir + '/' : '';
    } else if (['texture', 'hfield'].includes(el.tagName.toLowerCase())) {
      prefix = textureDir ? textureDir + '/' : '';
    }

    const fullPath = normalizeVfsPath(currentDir + prefix + fileAttr);

    paths.push(fullPath);
  });
  return paths;
}
