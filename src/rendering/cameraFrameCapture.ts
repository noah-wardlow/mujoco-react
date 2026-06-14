/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offscreen camera-frame capture for R3F/MuJoCo scenes.
 */

import * as THREE from 'three';
import type {
  CameraFrameCaptureBlobResult,
  CameraFrameCaptureOptions,
  CameraFrameCaptureResult,
  CameraFrameCaptureVector3,
} from '../types';

function toVector3(
  value: CameraFrameCaptureVector3 | undefined,
  fallback: THREE.Vector3
): THREE.Vector3 {
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

function createCaptureCamera(
  options: CameraFrameCaptureOptions,
  fallbackCamera: THREE.Camera,
  width: number,
  height: number
): THREE.Camera {
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

function readRenderTargetToCanvas(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number
) {
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a 2D canvas for camera frame capture.');
  }

  const imageData = context.createImageData(width, height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (height - y - 1) * rowBytes;
    const targetStart = y * rowBytes;
    imageData.data.set(
      pixels.subarray(sourceStart, sourceStart + rowBytes),
      targetStart
    );
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function renderCameraFrameToCanvas(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions = {}
) {
  const width = Math.max(1, Math.floor(options.width ?? renderer.domElement.width));
  const height = Math.max(1, Math.floor(options.height ?? renderer.domElement.height));
  const camera = createCaptureCamera(options, fallbackCamera, width, height);
  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  const previousTarget = renderer.getRenderTarget();
  const previousXrEnabled = renderer.xr.enabled;

  scene.updateMatrixWorld(true);
  try {
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    const canvas = readRenderTargetToCanvas(renderer, target, width, height);
    return { canvas, camera, width, height };
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = previousXrEnabled;
    target.dispose();
  }
}

export async function captureCameraFrame(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions = {}
): Promise<CameraFrameCaptureResult> {
  const type = options.type ?? 'image/png';
  const result = renderCameraFrameToCanvas(
    renderer,
    scene,
    fallbackCamera,
    options
  );
  return {
    ...result,
    dataUrl: result.canvas.toDataURL(type, options.quality),
    type,
  };
}

export async function captureCameraFrameBlob(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions = {}
): Promise<CameraFrameCaptureBlobResult> {
  const type = options.type ?? 'image/png';
  const result = renderCameraFrameToCanvas(
    renderer,
    scene,
    fallbackCamera,
    options
  );
  const blob = await new Promise<Blob>((resolve, reject) => {
    result.canvas.toBlob(
      (nextBlob) => {
        if (nextBlob) resolve(nextBlob);
        else reject(new Error('Camera frame capture did not produce a Blob.'));
      },
      type,
      options.quality
    );
  });
  return { ...result, blob, type };
}
