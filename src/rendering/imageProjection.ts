/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Project detector/image coordinates from a camera view into the rendered MuJoCo scene.
 */

import * as THREE from 'three';
import type {
  CameraFrameCaptureOptions,
  CameraFrameCaptureSource,
  ImagePointCoordinateSpace,
  ImagePointProjectionOptions,
  ImagePointProjectionResult,
} from '../types';
import { CAPTURE_EXCLUDE_KEY } from './cameraFrameCapture';

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function toVector3(
  value: CameraFrameCaptureOptions['position'] | undefined,
  fallback: THREE.Vector3
) {
  if (!value) return fallback.clone();
  return value instanceof THREE.Vector3
    ? value.clone()
    : new THREE.Vector3(value[0], value[1], value[2]);
}

function applyCameraPose(
  camera: THREE.Camera,
  options: CameraFrameCaptureOptions,
  fallbackCamera: THREE.Camera
) {
  camera.position.copy(toVector3(options.position, fallbackCamera.position));
  camera.up.copy(toVector3(options.up, fallbackCamera.up));

  if (options.quaternion) {
    if (options.quaternion instanceof THREE.Quaternion) {
      camera.quaternion.copy(options.quaternion);
    } else {
      camera.quaternion.set(
        options.quaternion[0],
        options.quaternion[1],
        options.quaternion[2],
        options.quaternion[3]
      );
    }
  } else if (options.lookAt) {
    camera.lookAt(toVector3(options.lookAt, new THREE.Vector3()));
  } else {
    camera.quaternion.copy(fallbackCamera.quaternion);
  }

  camera.updateMatrixWorld();
}

function createProjectionCamera(
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions,
  width: number,
  height: number
) {
  const camera = options.camera
    ? options.camera.clone()
    : fallbackCamera instanceof THREE.PerspectiveCamera
      ? fallbackCamera.clone()
      : new THREE.PerspectiveCamera(45, width / height, 0.01, 100);

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = width / height;
    camera.fov = options.fov ?? camera.fov;
    camera.near = options.near ?? camera.near;
    camera.far = options.far ?? camera.far;
    camera.updateProjectionMatrix();
  }

  applyCameraPose(camera, options, fallbackCamera);
  return camera;
}

function getProjectionSource(options: CameraFrameCaptureOptions): CameraFrameCaptureSource {
  if (options.source) return options.source;
  if (options.cameraName) return { kind: 'mujoco-camera', cameraName: options.cameraName };
  if (options.siteName) return { kind: 'mujoco-site', siteName: options.siteName };
  if (options.bodyName) return { kind: 'mujoco-body', bodyName: options.bodyName };
  if (options.camera) return { kind: 'custom-camera' };
  if (options.position || options.lookAt || options.quaternion) return { kind: 'explicit-pose' };
  return { kind: 'fallback-camera' };
}

function imageSize(
  renderer: THREE.WebGLRenderer,
  options: ImagePointProjectionOptions
): [number, number] {
  return [
    Math.max(1, Math.floor(options.imageWidth ?? options.width ?? renderer.domElement.width)),
    Math.max(1, Math.floor(options.imageHeight ?? options.height ?? renderer.domElement.height)),
  ];
}

export function imagePointToNdc(
  x: number,
  y: number,
  coordinateSpace: ImagePointCoordinateSpace = 'normalized',
  width = 1,
  height = 1
): [number, number] {
  if (coordinateSpace === 'ndc') return [x, y];
  if (coordinateSpace === 'normalized-1000') {
    return [(x / 1000) * 2 - 1, 1 - (y / 1000) * 2];
  }
  if (coordinateSpace === 'pixel') {
    return [(x / width) * 2 - 1, 1 - (y / height) * 2];
  }
  return [x * 2 - 1, 1 - y * 2];
}

function isProjectionCandidate(object: THREE.Object3D, options: ImagePointProjectionOptions) {
  if (!object.visible) return false;
  if (object.userData[CAPTURE_EXCLUDE_KEY]) return false;

  const geomGroup = object.userData.geomGroup;
  const geomName = object.userData.geomName;
  if (options.hiddenGeomNames && typeof geomName === 'string' && options.hiddenGeomNames.includes(geomName)) {
    return false;
  }
  if (options.hiddenGeomGroups && typeof geomGroup === 'number' && options.hiddenGeomGroups.includes(geomGroup)) {
    return false;
  }
  if (options.visibleGeomGroups && typeof geomGroup === 'number' && !options.visibleGeomGroups.includes(geomGroup)) {
    return false;
  }
  return true;
}

function findBodyId(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current && current.userData.bodyID === undefined && current.parent) {
    current = current.parent;
  }
  return typeof current?.userData.bodyID === 'number' ? current.userData.bodyID : -1;
}

export function projectImagePointTo3D(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: ImagePointProjectionOptions
): ImagePointProjectionResult | null {
  const [width, height] = imageSize(renderer, options);
  const [ndcX, ndcY] = imagePointToNdc(
    options.x,
    options.y,
    options.coordinateSpace,
    width,
    height
  );
  const projectionCamera = createProjectionCamera(fallbackCamera, options, width, height);

  scene.updateMatrixWorld(true);
  _ndc.set(ndcX, ndcY);
  _raycaster.setFromCamera(_ndc, projectionCamera);
  _raycaster.far = options.maxDistance ?? Infinity;

  const objects: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && isProjectionCandidate(object, options)) {
      objects.push(object);
    }
  });

  const [hit] = _raycaster.intersectObjects(objects, true);
  if (!hit) return null;

  return {
    point: hit.point.clone(),
    bodyId: findBodyId(hit.object),
    geomId: typeof hit.object.userData.geomID === 'number' ? hit.object.userData.geomID : -1,
    distance: hit.distance,
    ndc: [ndcX, ndcY],
    imageSize: [width, height],
    source: getProjectionSource(options),
  };
}
