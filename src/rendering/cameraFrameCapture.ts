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
  captureAsync(options?: CameraFrameCaptureOptions): Promise<{
    canvas: HTMLCanvasElement;
    camera: THREE.Camera;
    width: number;
    height: number;
    source: CameraFrameCaptureSource;
  }>;
  captureDataUrl(options?: CameraFrameCaptureOptions): CameraFrameCaptureResult;
  captureDataUrlAsync(
    options?: CameraFrameCaptureOptions
  ): Promise<CameraFrameCaptureResult>;
  captureBlob(options?: CameraFrameCaptureOptions): Promise<CameraFrameCaptureBlobResult>;
  dispose(): void;
}

export const CAMERA_FRAME_CAPTURE_RENDER_USER_DATA_KEY =
  'mujocoReactCameraFrameCaptureRender';
export const CAPTURE_EXCLUDE_KEY =
  'mujoco.capture.exclude';

export type CameraFrameCaptureRenderInput = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  target: THREE.WebGLRenderTarget;
  width: number;
  height: number;
};

export type CameraFrameCaptureRenderResult = {
  pixels: Uint8Array;
  width?: number;
  height?: number;
  flipY?: boolean;
};

type CameraFrameCaptureRender = (
  input: CameraFrameCaptureRenderInput
) =>
  | CameraFrameCaptureRenderResult
  | null
  | undefined
  | Promise<CameraFrameCaptureRenderResult | null | undefined>;

type RendererState = {
  target: THREE.WebGLRenderTarget | null;
  xrEnabled: boolean;
  viewport: THREE.Vector4;
  scissor: THREE.Vector4;
  scissorTest: boolean;
  clearColor: THREE.Color;
  clearAlpha: number;
  autoClear: boolean;
};

type VisibilityState = {
  object: THREE.Object3D;
  visible: boolean;
};

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
  height: number,
  outputColorSpace: string
) {
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

  const rowBytes = width * 4;
  const encodeSrgb = outputColorSpace === THREE.SRGBColorSpace;
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (height - y - 1) * rowBytes;
    const targetStart = y * rowBytes;
    const row = pixels.subarray(sourceStart, sourceStart + rowBytes);
    if (!encodeSrgb) {
      imageData.data.set(row, targetStart);
      continue;
    }

    for (let x = 0; x < rowBytes; x += 4) {
      const pixelOffset = targetStart + x;
      imageData.data[pixelOffset] = linearByteToSrgbByte(row[x]);
      imageData.data[pixelOffset + 1] = linearByteToSrgbByte(row[x + 1]);
      imageData.data[pixelOffset + 2] = linearByteToSrgbByte(row[x + 2]);
      imageData.data[pixelOffset + 3] = row[x + 3];
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function linearByteToSrgbByte(value: number) {
  const normalized = value / 255;
  const encoded =
    normalized <= 0.0031308
      ? normalized * 12.92
      : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(encoded * 255)));
}

function readPixelsToCanvas(
  pixels: Uint8Array,
  context: CanvasRenderingContext2D,
  imageData: ImageData,
  width: number,
  height: number,
  flipY = true
) {
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const sourceY = flipY ? height - y - 1 : y;
    const sourceStart = sourceY * rowBytes;
    const targetStart = y * rowBytes;
    imageData.data.set(
      pixels.subarray(sourceStart, sourceStart + rowBytes),
      targetStart
    );
  }
  context.putImageData(imageData, 0, 0);
}

function hideExcludedCaptureObjects(scene: THREE.Scene): VisibilityState[] {
  const hidden: VisibilityState[] = [];
  scene.traverse((object) => {
    if (!object.visible) return;
    if (!object.userData[CAPTURE_EXCLUDE_KEY]) return;
    hidden.push({ object, visible: object.visible });
    object.visible = false;
  });
  return hidden;
}

function restoreObjectVisibility(hidden: VisibilityState[]) {
  for (const { object, visible } of hidden) {
    object.visible = visible;
  }
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

function saveRendererState(renderer: THREE.WebGLRenderer): RendererState {
  const viewport = new THREE.Vector4();
  const scissor = new THREE.Vector4();
  const clearColor = new THREE.Color();
  renderer.getViewport(viewport);
  renderer.getScissor(scissor);
  renderer.getClearColor(clearColor);
  return {
    target: renderer.getRenderTarget(),
    xrEnabled: renderer.xr.enabled,
    viewport,
    scissor,
    scissorTest: renderer.getScissorTest(),
    clearColor,
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
}

function restoreRendererState(
  renderer: THREE.WebGLRenderer,
  state: RendererState
) {
  renderer.setRenderTarget(state.target);
  renderer.xr.enabled = state.xrEnabled;
  renderer.setViewport(state.viewport);
  renderer.setScissor(state.scissor);
  renderer.setScissorTest(state.scissorTest);
  renderer.setClearColor(state.clearColor, state.clearAlpha);
  renderer.autoClear = state.autoClear;
}

function getCaptureRenderer(
  scene: THREE.Scene
): CameraFrameCaptureRender | null {
  const renderers: CameraFrameCaptureRender[] = [];
  scene.traverse((object) => {
    if (renderers.length) return;
    const render = object.userData[
      CAMERA_FRAME_CAPTURE_RENDER_USER_DATA_KEY
    ] as CameraFrameCaptureRender | undefined;
    if (typeof render === 'function') renderers.push(render);
  });
  return renderers[0] ?? null;
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

  function resolveCaptureOptions(nextOptions: CameraFrameCaptureOptions = {}) {
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

    return captureOptions;
  }

  function renderPreparedCapture(captureOptions: CameraFrameCaptureOptions) {
    const previousState = saveRendererState(renderer);
    const hidden = hideExcludedCaptureObjects(scene);

    scene.updateMatrixWorld(true);
    try {
      renderer.xr.enabled = false;
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
      renderer.setScissorTest(false);
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
        height,
        renderer.outputColorSpace
      );
      return {
        canvas,
        camera,
        width,
        height,
        source: getCameraFrameCaptureSource(captureOptions),
      };
    } finally {
      restoreObjectVisibility(hidden);
      restoreRendererState(renderer, previousState);
    }
  }

  function capture(nextOptions: CameraFrameCaptureOptions = {}) {
    return renderPreparedCapture(resolveCaptureOptions(nextOptions));
  }

  async function captureAsync(nextOptions: CameraFrameCaptureOptions = {}) {
    const captureOptions = resolveCaptureOptions(nextOptions);
    scene.updateMatrixWorld(true);
    const captureRenderer = getCaptureRenderer(scene);
    if (captureRenderer) {
      const previousState = saveRendererState(renderer);
      const hidden = hideExcludedCaptureObjects(scene);
      try {
        renderer.xr.enabled = false;
        const captureResult = await captureRenderer({
          renderer,
          scene,
          camera,
          target,
          width,
          height,
        });
        if (captureResult) {
          const captureWidth = captureResult.width ?? width;
          const captureHeight = captureResult.height ?? height;
          if (captureWidth !== width || captureHeight !== height) {
            throw new Error(
              'Camera frame capture renderer returned unexpected dimensions.'
            );
          }
          readPixelsToCanvas(
            captureResult.pixels,
            drawContext,
            imageData,
            width,
            height,
            captureResult.flipY ?? true
          );
          return {
            canvas,
            camera,
            width,
            height,
            source: getCameraFrameCaptureSource(captureOptions),
          };
        }
      } finally {
        restoreObjectVisibility(hidden);
        restoreRendererState(renderer, previousState);
      }
    }
    return renderPreparedCapture(captureOptions);
  }

  return {
    width,
    height,
    capture,
    captureAsync,
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
    async captureDataUrlAsync(nextOptions = {}) {
      const type = nextOptions.type ?? options.type ?? 'image/png';
      const result = await captureAsync(nextOptions);
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
      const result = await captureAsync(nextOptions);
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
  const session = createCameraFrameCaptureSession(
    renderer,
    scene,
    fallbackCamera,
    options
  );
  try {
    const result = await session.captureAsync();
    return {
      ...result,
      dataUrl: result.canvas.toDataURL(type, options.quality),
      type,
    };
  } finally {
    session.dispose();
  }
}

export async function captureCameraFrameBlob(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions = {}
): Promise<CameraFrameCaptureBlobResult> {
  const session = createCameraFrameCaptureSession(
    renderer,
    scene,
    fallbackCamera,
    options
  );
  try {
    return await session.captureBlob();
  } finally {
    session.dispose();
  }
}
