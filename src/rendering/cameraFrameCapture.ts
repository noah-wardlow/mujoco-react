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
export const CAMERA_FRAME_CAPTURE_PRE_RENDER_USER_DATA_KEY =
  'mujocoReactCameraFrameCapturePreRender';
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
  flipX?: boolean;
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
  shadowMapEnabled: boolean;
  toneMapping: THREE.WebGLRenderer['toneMapping'];
  outputColorSpace: THREE.WebGLRenderer['outputColorSpace'];
};

type SceneVisualState = {
  background: THREE.Scene['background'];
  environment: THREE.Scene['environment'];
  fog: THREE.Scene['fog'];
};

type VisibilityState = {
  object: THREE.Object3D;
  visible: boolean;
};

type CameraFrameCapturePreRender = () => void;

const isolatedRendererCache = new WeakMap<
  THREE.WebGLRenderer,
  Map<string, THREE.WebGLRenderer>
>();

function shouldUseRenderIsolation(
  options: CameraFrameCaptureOptions
): boolean {
  return options.renderIsolation === true || (
    typeof options.renderIsolation === 'object' &&
    options.renderIsolation.enabled !== false
  );
}

function getRenderIsolationOptions(
  options: CameraFrameCaptureOptions
) {
  return typeof options.renderIsolation === 'object'
    ? options.renderIsolation
    : {};
}

function getRenderIsolationCacheKey(
  width: number,
  height: number,
  options: CameraFrameCaptureOptions
) {
  const isolation = getRenderIsolationOptions(options);
  return JSON.stringify({
    width,
    height,
    antialias: isolation.antialias ?? false,
    alpha: isolation.alpha ?? false,
    preserveDrawingBuffer: isolation.preserveDrawingBuffer ?? false,
    powerPreference: isolation.powerPreference ?? null,
  });
}

function createIsolatedRenderer(
  sourceRenderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  options: CameraFrameCaptureOptions
): { renderer: THREE.WebGLRenderer; cached: boolean } | null {
  if (!shouldUseRenderIsolation(options)) return null;

  const isolation = getRenderIsolationOptions(options);
  if (isolation.cache !== false) {
    const cacheKey = getRenderIsolationCacheKey(width, height, options);
    let rendererCache = isolatedRendererCache.get(sourceRenderer);
    if (!rendererCache) {
      rendererCache = new Map();
      isolatedRendererCache.set(sourceRenderer, rendererCache);
    }
    const cachedRenderer = rendererCache.get(cacheKey);
    if (cachedRenderer) {
      cachedRenderer.outputColorSpace = sourceRenderer.outputColorSpace;
      cachedRenderer.toneMapping = sourceRenderer.toneMapping;
      cachedRenderer.shadowMap.enabled = false;
      return { renderer: cachedRenderer, cached: true };
    }
    const createdRenderer = createUncachedIsolatedRenderer(
      sourceRenderer,
      width,
      height,
      options
    );
    rendererCache.set(cacheKey, createdRenderer);
    return { renderer: createdRenderer, cached: true };
  }

  return {
    renderer: createUncachedIsolatedRenderer(sourceRenderer, width, height, options),
    cached: false,
  };
}

function createUncachedIsolatedRenderer(
  sourceRenderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  options: CameraFrameCaptureOptions
) {
  const isolation = getRenderIsolationOptions(options);
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: isolation.antialias ?? false,
    alpha: isolation.alpha ?? false,
    preserveDrawingBuffer: isolation.preserveDrawingBuffer ?? false,
    powerPreference: isolation.powerPreference,
  });

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = sourceRenderer.outputColorSpace;
  renderer.toneMapping = sourceRenderer.toneMapping;
  renderer.shadowMap.enabled = false;
  return renderer;
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

function applyProjectionMatrix(
  camera: THREE.Camera,
  projectionMatrix: CameraFrameCaptureOptions['projectionMatrix'] | undefined
) {
  if (!projectionMatrix) return;
  if (projectionMatrix instanceof THREE.Matrix4) {
    camera.projectionMatrix.copy(projectionMatrix);
  } else {
    camera.projectionMatrix.fromArray(projectionMatrix);
  }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
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
  applyProjectionMatrix(camera, options.projectionMatrix);

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
  applyProjectionMatrix(camera, options.projectionMatrix);

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
  outputColorSpace: string,
  flipX = false
) {
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

  const rowBytes = width * 4;
  const encodeSrgb = outputColorSpace === THREE.SRGBColorSpace;
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (height - y - 1) * rowBytes;
    const targetStart = y * rowBytes;
    const row = pixels.subarray(sourceStart, sourceStart + rowBytes);
    if (!encodeSrgb && !flipX) {
      imageData.data.set(row, targetStart);
      continue;
    }

    for (let x = 0; x < width; x += 1) {
      const sourceX = flipX ? width - x - 1 : x;
      const sourceOffset = sourceX * 4;
      const targetOffset = targetStart + x * 4;
      imageData.data[targetOffset] = encodeSrgb
        ? linearByteToSrgbByte(row[sourceOffset])
        : row[sourceOffset];
      imageData.data[targetOffset + 1] = encodeSrgb
        ? linearByteToSrgbByte(row[sourceOffset + 1])
        : row[sourceOffset + 1];
      imageData.data[targetOffset + 2] = encodeSrgb
        ? linearByteToSrgbByte(row[sourceOffset + 2])
        : row[sourceOffset + 2];
      imageData.data[targetOffset + 3] = row[sourceOffset + 3];
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
  flipY = true,
  flipX = false
) {
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const sourceY = flipY ? height - y - 1 : y;
    const sourceStart = sourceY * rowBytes;
    const targetStart = y * rowBytes;
    if (!flipX) {
      imageData.data.set(
        pixels.subarray(sourceStart, sourceStart + rowBytes),
        targetStart
      );
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const sourceX = width - x - 1;
      const sourceOffset = sourceStart + sourceX * 4;
      const targetOffset = targetStart + x * 4;
      imageData.data[targetOffset] = pixels[sourceOffset];
      imageData.data[targetOffset + 1] = pixels[sourceOffset + 1];
      imageData.data[targetOffset + 2] = pixels[sourceOffset + 2];
      imageData.data[targetOffset + 3] = pixels[sourceOffset + 3];
    }
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

function hideCaptureGeomGroups(
  scene: THREE.Scene,
  options: CameraFrameCaptureOptions
): VisibilityState[] {
  const hidden: VisibilityState[] = [];
  const hiddenGroups = options.hiddenGeomGroups
    ? new Set(options.hiddenGeomGroups)
    : null;
  const visibleGroups = options.visibleGeomGroups
    ? new Set(options.visibleGeomGroups)
    : null;
  const hiddenNames = options.hiddenGeomNames
    ? new Set(options.hiddenGeomNames)
    : null;
  if (!hiddenGroups && !visibleGroups && !hiddenNames) return hidden;

  scene.traverse((object) => {
    if (!object.visible) return;
    const geomGroup = object.userData.geomGroup;
    const geomName = object.userData.geomName;
    if (typeof geomGroup !== 'number' && typeof geomName !== 'string') return;
    if (
      hiddenNames?.has(geomName) ||
      hiddenGroups?.has(geomGroup) ||
      (typeof geomGroup === 'number' && visibleGroups && !visibleGroups.has(geomGroup))
    ) {
      hidden.push({ object, visible: object.visible });
      object.visible = false;
    }
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
    shadowMapEnabled: renderer.shadowMap.enabled,
    toneMapping: renderer.toneMapping,
    outputColorSpace: renderer.outputColorSpace,
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
  renderer.shadowMap.enabled = state.shadowMapEnabled;
  renderer.toneMapping = state.toneMapping;
  renderer.outputColorSpace = state.outputColorSpace;
}

function saveSceneVisualState(scene: THREE.Scene): SceneVisualState {
  return {
    background: scene.background,
    environment: scene.environment,
    fog: scene.fog,
  };
}

function restoreSceneVisualState(scene: THREE.Scene, state: SceneVisualState) {
  scene.background = state.background;
  scene.environment = state.environment;
  scene.fog = state.fog;
}

function hasOwn<T extends object>(object: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function applyCaptureVisualOverrides(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options: CameraFrameCaptureOptions
): SceneVisualState | null {
  const overrides = options.visualOverrides;
  if (!overrides) return null;

  const previousSceneState = saveSceneVisualState(scene);
  if (hasOwn(overrides, 'sceneBackground')) {
    const background = overrides.sceneBackground;
    scene.background = background === false ? null : (
      typeof background === 'string' || typeof background === 'number'
        ? new THREE.Color(background)
        : background ?? null
    );
  }
  if (hasOwn(overrides, 'sceneEnvironment')) {
    const environment = overrides.sceneEnvironment;
    scene.environment = environment === false ? null : environment ?? null;
  }
  if (hasOwn(overrides, 'sceneFog')) {
    const fog = overrides.sceneFog;
    scene.fog = fog === false ? null : fog ?? null;
  }
  if (overrides.shadows !== undefined) {
    renderer.shadowMap.enabled = overrides.shadows;
  }
  if (overrides.toneMapping !== undefined) {
    renderer.toneMapping = overrides.toneMapping;
  }
  if (overrides.outputColorSpace !== undefined) {
    renderer.outputColorSpace = overrides.outputColorSpace;
  }
  return previousSceneState;
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

function runCapturePreRenderHooks(scene: THREE.Scene) {
  const callbacks: CameraFrameCapturePreRender[] = [];
  scene.traverse((object) => {
    const callback = object.userData[
      CAMERA_FRAME_CAPTURE_PRE_RENDER_USER_DATA_KEY
    ] as CameraFrameCapturePreRender | undefined;
    if (typeof callback === 'function') callbacks.push(callback);
  });
  for (const callback of callbacks) callback();
}

export function createCameraFrameCaptureSession(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  fallbackCamera: THREE.Camera,
  options: CameraFrameCaptureOptions = {}
): CameraFrameCaptureSession {
  const { width, height } = getCaptureDimensions(renderer, options);
  const isolatedRenderer = createIsolatedRenderer(renderer, width, height, options);
  const sessionRenderer = isolatedRenderer?.renderer ?? renderer;
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
    if (
      shouldUseRenderIsolation(captureOptions) !== shouldUseRenderIsolation(options)
    ) {
      throw new Error(
        'Camera frame capture sessions require stable renderIsolation settings.'
      );
    }
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
    const previousState = saveRendererState(sessionRenderer);
    const previousSceneState = applyCaptureVisualOverrides(
      sessionRenderer,
      scene,
      captureOptions
    );
    const hidden = [
      ...hideExcludedCaptureObjects(scene),
      ...hideCaptureGeomGroups(scene, captureOptions),
    ];

    runCapturePreRenderHooks(scene);
    scene.updateMatrixWorld(true);
    try {
      sessionRenderer.xr.enabled = false;
      sessionRenderer.setRenderTarget(target);
      sessionRenderer.setViewport(0, 0, width, height);
      sessionRenderer.setScissor(0, 0, width, height);
      sessionRenderer.setScissorTest(false);
      if (captureOptions.background !== undefined) {
        sessionRenderer.setClearColor(
          new THREE.Color(captureOptions.background),
          captureOptions.backgroundAlpha ?? previousState.clearAlpha
        );
      } else if (captureOptions.backgroundAlpha !== undefined) {
        sessionRenderer.setClearColor(previousState.clearColor, captureOptions.backgroundAlpha);
      }
      sessionRenderer.clear();
      sessionRenderer.render(scene, camera);
      readRenderTargetToCanvas(
        sessionRenderer,
        target,
        canvas,
        drawContext,
        pixels,
        imageData,
        width,
        height,
        sessionRenderer.outputColorSpace,
        captureOptions.flipX ?? false
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
      if (previousSceneState) restoreSceneVisualState(scene, previousSceneState);
      restoreRendererState(sessionRenderer, previousState);
    }
  }

  function capture(nextOptions: CameraFrameCaptureOptions = {}) {
    return renderPreparedCapture(resolveCaptureOptions(nextOptions));
  }

  async function captureAsync(nextOptions: CameraFrameCaptureOptions = {}) {
    const captureOptions = resolveCaptureOptions(nextOptions);
    runCapturePreRenderHooks(scene);
    scene.updateMatrixWorld(true);
    const captureRenderer = getCaptureRenderer(scene);
    if (captureRenderer) {
      const previousState = saveRendererState(sessionRenderer);
      const previousSceneState = applyCaptureVisualOverrides(
        sessionRenderer,
        scene,
        captureOptions
      );
      const hidden = [
        ...hideExcludedCaptureObjects(scene),
        ...hideCaptureGeomGroups(scene, captureOptions),
      ];
      try {
        sessionRenderer.xr.enabled = false;
        if (captureOptions.background !== undefined) {
          sessionRenderer.setClearColor(
            new THREE.Color(captureOptions.background),
            captureOptions.backgroundAlpha ?? previousState.clearAlpha
          );
        } else if (captureOptions.backgroundAlpha !== undefined) {
          sessionRenderer.setClearColor(previousState.clearColor, captureOptions.backgroundAlpha);
        }
        const captureResult = await captureRenderer({
          renderer: sessionRenderer,
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
            captureResult.flipY ?? true,
            captureResult.flipX ?? captureOptions.flipX ?? false
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
        if (previousSceneState) restoreSceneVisualState(scene, previousSceneState);
        restoreRendererState(sessionRenderer, previousState);
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
      if (isolatedRenderer && !isolatedRenderer.cached) {
        isolatedRenderer.renderer.dispose();
      }
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
