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
  const pos = obj.position.map((v) => v.toFixed(3)).join(' ');
  const size = obj.size.map((v) => v.toFixed(3)).join(' ');
  const rgba = obj.rgba.join(' ');
  const mass = obj.mass ? ` mass="${obj.mass}"` : '';
  const friction = obj.friction ? ` friction="${obj.friction}"` : '';
  const solref = obj.solref ? ` solref="${obj.solref}"` : '';
  const solimp = obj.solimp ? ` solimp="${obj.solimp}"` : '';
  const condim = obj.condim ? ` condim="${obj.condim}"` : '';
  // Always set contype/conaffinity=1 so objects collide regardless of model defaults
  return `<body name="${obj.name}" pos="${pos}">${joint}<geom type="${obj.type}" size="${size}" rgba="${rgba}" contype="1" conaffinity="1"${mass}${friction}${solref}${solimp}${condim}/></body>`;
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

/**
 * Config-driven scene loader — replaces the old RobotLoader + patchSingleRobot approach.
 */
export async function loadScene(
  mujoco: MujocoModule,
  config: SceneConfig,
  onProgress?: (msg: string) => void
): Promise<LoadResult> {
  // 1. Clean up virtual filesystem
  try { mujoco.FS.unmount('/working'); } catch { /* ignore */ }
  try { mujoco.FS.mkdir('/working'); } catch { /* ignore */ }

  const baseUrl = config.src.endsWith('/') ? config.src : config.src + '/';

  const downloaded = new Set<string>();
  const xmlQueue: string[] = [config.sceneFile];
  const assetFiles: string[] = [];
  const parser = new DOMParser();

  // 2a. Download XML files sequentially (to discover dependencies)
  while (xmlQueue.length > 0) {
    const fname = xmlQueue.shift()!;
    if (downloaded.has(fname)) continue;
    downloaded.add(fname);

    if (!fname.endsWith('.xml')) {
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

    let text = await res.text();

    // 3. Apply XML patches from config
    for (const patch of config.xmlPatches ?? []) {
      if (fname.endsWith(patch.target) || fname === patch.target) {
        if (patch.replace) {
          const [from, to] = patch.replace;
          if (text.includes(from)) {
            text = text.replace(from, to);
          } else {
            const preview = from.length > 80 ? `${from.slice(0, 80)}...` : from;
            console.warn(`XML patch replace pattern not found in ${fname}: "${preview}"`);
          }
        }
        if (patch.inject && patch.injectAfter) {
          const idx = text.indexOf(patch.injectAfter);
          if (idx !== -1) {
            const tagEnd = text.indexOf('>', idx + patch.injectAfter.length);
            if (tagEnd !== -1) {
              text = text.slice(0, tagEnd + 1) + patch.inject + text.slice(tagEnd + 1);
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

    // 4. Inject scene objects into the scene file
    if (fname === config.sceneFile && config.sceneObjects?.length) {
      const xml = config.sceneObjects.map((obj) => sceneObjectToXml(obj)).join('');
      text = text.replace('</worldbody>', xml + '</worldbody>');
    }

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
  if (config.homeJoints) {
    const homeCount = Math.min(config.homeJoints.length, mjModel.nu);
    for (let i = 0; i < homeCount; i++) {
      mjData.ctrl[i] = config.homeJoints[i];
      const qposAdr = getActuatedScalarQposAdr(mjModel, i);
      if (qposAdr !== -1) {
        mjData.qpos[qposAdr] = config.homeJoints[i];
      }
    }
  }

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
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const compiler = xmlDoc.querySelector('compiler');
  const assetDir = compiler?.getAttribute('assetdir') || '';
  const meshDir = compiler?.getAttribute('meshdir') || assetDir;
  const textureDir = compiler?.getAttribute('texturedir') || assetDir;
  const currentDir = currentFile.includes('/')
    ? currentFile.substring(0, currentFile.lastIndexOf('/') + 1)
    : '';

  xmlDoc.querySelectorAll('[file]').forEach((el) => {
    const fileAttr = el.getAttribute('file');
    if (!fileAttr) return;

    let prefix = '';
    if (el.tagName.toLowerCase() === 'mesh') {
      prefix = meshDir ? meshDir + '/' : '';
    } else if (['texture', 'hfield'].includes(el.tagName.toLowerCase())) {
      prefix = textureDir ? textureDir + '/' : '';
    }

    let fullPath = (currentDir + prefix + fileAttr).replace(/\/\//g, '/');
    const parts = fullPath.split('/');
    const norm: string[] = [];
    for (const p of parts) {
      if (p === '..') norm.pop();
      else if (p !== '.') norm.push(p);
    }
    fullPath = norm.join('/');

    if (!downloaded.has(fullPath)) queue.push(fullPath);
  });
}
