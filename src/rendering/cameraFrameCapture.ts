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
  CameraFrameCaptureSource,
  CameraFrameCaptureVector3,
} from '../types';

export interface CameraFrameCaptureSession {
  readonly width: number;
  readonly height: number;
  capture(options?: CameraFrameCaptureOptions): {
    canvas: HTMLCanvasElement;
    camera: THREE.Camera;
    width: number;
    height: number;
    source: CameraFrameCaptureSource;
  };
  captureDataUrl(options?: CameraFrameCaptureOptions): CameraFrameCaptureResult;
  captureBlob(options?: CameraFrameCaptureOptions): Promise<CameraFrameCaptureBlobResult>;
  dispose(): void;
}

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

function getCaptureDimensions(
  renderer: THREE.WebGLRenderer,
  options: CameraFrameCaptureOptions
) {
  const width = Math.max(
    1,
    Math.floor(options.width ?? renderer.domElement.width)
  );
  const height = Math.max(
    1,
    Math.floor(options.height ?? renderer.domElement.height)
  );
  return { width, height };
}

function prepareCaptureCamera(
  camera: THREE.Camera,
  options: CameraFrameCaptureOptions,
  fallbackCamera: THREE.Camera,
  width: number,
  height: number
) {
  if (options.camera) {
    camera.copy(options.camera);
  }

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = width / height;
    camera.fov = options.fov ?? camera.fov;
    camera.near = options.near ?? camera.near;
    camera.far = options.far ?? camera.far;
    camera.updateProjectionMatrix();
  }

  applyCameraPose(camera, options, fallbackCamera);
}

function readRenderTargetToCanvas(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  pixels: Uint8Array,
  imageData: ImageData,
  width: number,
  height: number
) {
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

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

function getCameraFrameCaptureSource(
  options: CameraFrameCaptureOptions
): CameraFrameCaptureSource {
  if (options.source) return options.source;
  if (options.cameraName) {
    return { kind: 'mujoco-camera', cameraName: options.cameraName };
  }
  if (options.siteName) {
    return { kind: 'mujoco-site', siteName: options.siteName };
  }
  if (options.bodyName) {
    return { kind: 'mujoco-body', bodyName: options.bodyName };
  }
  if (options.camera) return { kind: 'custom-camera' };
  if (options.position || options.lookAt || options.quaternion) {
    return { kind: 'explicit-pose' };
  }
  return { kind: 'fallback-camera' };
}

export function createCameraFrameCaptureSession(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions = {}
): CameraFrameCaptureSession {
  const { width, height } = getCaptureDimensions(renderer, options);
  const camera = createCaptureCamera(options, fallbackCamera, width, height);
  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    target.dispose();
    throw new Error('Unable to create a 2D canvas for camera frame capture.');
  }
  const drawContext = context;

  const pixels = new Uint8Array(width * height * 4);
  const imageData = drawContext.createImageData(width, height);

  function capture(nextOptions: CameraFrameCaptureOptions = {}) {
    const captureOptions = { ...options, ...nextOptions };
    const nextDimensions = getCaptureDimensions(renderer, captureOptions);
    if (
      nextDimensions.width !== width ||
      nextDimensions.height !== height
    ) {
      throw new Error(
        'Camera frame capture sessions require stable width and height.'
      );
    }

    prepareCaptureCamera(
      camera,
      captureOptions,
      fallbackCamera,
      width,
      height
    );

    const previousTarget = renderer.getRenderTarget();
    const previousXrEnabled = renderer.xr.enabled;

    scene.updateMatrixWorld(true);
    try {
      renderer.xr.enabled = false;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      readRenderTargetToCanvas(
        renderer,
        target,
        canvas,
        drawContext,
        pixels,
        imageData,
        width,
        height
      );
      return {
        canvas,
        camera,
        width,
        height,
        source: getCameraFrameCaptureSource(captureOptions),
      };
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.xr.enabled = previousXrEnabled;
    }
  }

  return {
    width,
    height,
    capture,
    captureDataUrl(nextOptions = {}) {
      const type = nextOptions.type ?? options.type ?? 'image/png';
      const result = capture(nextOptions);
      return {
        ...result,
        dataUrl: result.canvas.toDataURL(
          type,
          nextOptions.quality ?? options.quality
        ),
        type,
      };
    },
    async captureBlob(nextOptions = {}) {
      const type = nextOptions.type ?? options.type ?? 'image/png';
      const result = capture(nextOptions);
      const blob = await new Promise<Blob>((resolve, reject) => {
        result.canvas.toBlob(
          (nextBlob) => {
            if (nextBlob) resolve(nextBlob);
            else reject(new Error('Camera frame capture did not produce a Blob.'));
          },
          type,
          nextOptions.quality ?? options.quality
        );
      });
      return { ...result, blob, type };
    },
    dispose() {
      target.dispose();
    },
  };
}

export function renderCameraFrameToCanvas(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions = {}
) {
  const session = createCameraFrameCaptureSession(
    renderer,
    scene,
    fallbackCamera,
    options
  );
  try {
    return session.capture();
  } finally {
    session.dispose();
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
