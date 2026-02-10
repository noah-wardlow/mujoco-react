/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MujocoData, MujocoModel, MujocoModule } from '../types';
import { SceneConfig, SceneObject, XmlPatch } from '../types';

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

interface LoadResult {
  mjModel: MujocoModel;
  mjData: MujocoData;
  siteId: number;
  gripperId: number;
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

  const baseUrl =
    config.baseUrl ||
    `https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/${config.robotId}/`;

  const downloaded = new Set<string>();
  const queue: string[] = [config.sceneFile];
  const parser = new DOMParser();

  // 2. Download all model files
  while (queue.length > 0) {
    const fname = queue.shift()!;
    if (downloaded.has(fname)) continue;
    downloaded.add(fname);

    onProgress?.(`Downloading ${fname}...`);

    const res = await fetch(baseUrl + fname);
    if (!res.ok) {
      console.warn(`Failed to fetch ${fname}: ${res.status} ${res.statusText}`);
      continue;
    }

    // Create virtual directory structure
    const dirParts = fname.split('/');
    dirParts.pop();
    let currentPath = '/working';
    for (const part of dirParts) {
      currentPath += '/' + part;
      try { mujoco.FS.mkdir(currentPath); } catch { /* ignore */ }
    }

    if (fname.endsWith('.xml')) {
      let text = await res.text();

      // 3. Apply XML patches from config
      for (const patch of config.xmlPatches ?? []) {
        if (fname.endsWith(patch.target) || fname === patch.target) {
          if (patch.replace) {
            text = text.replace(patch.replace[0], patch.replace[1]);
          }
          if (patch.inject && patch.injectAfter) {
            const idx = text.indexOf(patch.injectAfter);
            if (idx !== -1) {
              // Find the end of the opening tag (next '>') after the match
              const tagEnd = text.indexOf('>', idx + patch.injectAfter.length);
              if (tagEnd !== -1) {
                text = text.slice(0, tagEnd + 1) + patch.inject + text.slice(tagEnd + 1);
              }
            }
          }
        }
      }

      // 4. Inject scene objects into the scene file
      if (fname === config.sceneFile && config.sceneObjects?.length) {
        const xml = config.sceneObjects.map((obj) => sceneObjectToXml(obj)).join('');
        text = text.replace('</worldbody>', xml + '</worldbody>');
      }

      mujoco.FS.writeFile(`/working/${fname}`, text);
      scanDependencies(text, fname, parser, downloaded, queue);
    } else {
      const buffer = new Uint8Array(await res.arrayBuffer());
      mujoco.FS.writeFile(`/working/${fname}`, buffer);
    }
  }

  // 5. Load model
  onProgress?.('Loading model...');
  const mjModel = mujoco.MjModel.loadFromXML(`/working/${config.sceneFile}`);
  const mjData = new mujoco.MjData(mjModel);

  // 6. Find TCP site and gripper actuator
  const siteId = findSiteByName(mjModel, config.tcpSiteName ?? 'tcp');
  const gripperId = findActuatorByName(mjModel, config.gripperActuatorName ?? 'gripper');

  // 7. Set initial pose
  if (config.homeJoints) {
    for (let i = 0; i < config.homeJoints.length; i++) {
      mjData.ctrl[i] = config.homeJoints[i];
      if (mjModel.actuator_trnid[2 * i + 1] === 1) {
        const jointId = mjModel.actuator_trnid[2 * i];
        if (jointId >= 0 && jointId < mjModel.njnt) {
          const qposAdr = mjModel.jnt_qposadr[jointId];
          mjData.qpos[qposAdr] = config.homeJoints[i];
        }
      }
    }
  }

  mujoco.mj_forward(mjModel, mjData);

  return { mjModel, mjData, siteId, gripperId };
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
