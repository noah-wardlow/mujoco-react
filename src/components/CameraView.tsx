/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live on-screen camera viewports for MuJoCo scenes. Each view renders the
 * shared scene from a named MuJoCo camera/site/body into a `gl.scissor` region
 * tracking a DOM element — no GPU readback, no PNG encoding.
 *
 * While at least one viewport is mounted the canvas switches from R3F's
 * automatic render to a managed render loop (main scene full-frame, then each
 * viewport). This is incompatible with `EffectComposer`/postprocessing or other
 * custom render loops; use the offscreen capture APIs in those setups instead.
 */

import {
  createContext,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { useMujoco } from '../core/MujocoSimProvider';
import {
  createCaptureCamera,
  prepareCaptureCamera,
} from '../rendering/cameraFrameCapture';
import type {
  Bodies,
  Cameras,
  CameraFrameCaptureOptions,
  Sites,
} from '../types';

/** Camera selection + pose options for a live viewport. */
export type CameraViewportOptions = Pick<
  CameraFrameCaptureOptions,
  | 'camera'
  | 'cameraName'
  | 'siteName'
  | 'bodyName'
  | 'position'
  | 'quaternion'
  | 'lookAt'
  | 'up'
  | 'positionOffset'
  | 'quaternionOffset'
  | 'fov'
  | 'near'
  | 'far'
  | 'projectionMatrix'
  | 'mujocoCameraCompatibility'
>;

interface CameraViewportDescriptor {
  getElement: () => HTMLElement | null;
  getOptions: () => CameraViewportOptions;
  camera: THREE.Camera | null;
}

interface CameraViewportRegistry {
  register: (descriptor: CameraViewportDescriptor) => () => void;
}

const CameraViewportRegistryContext = createContext<CameraViewportRegistry | null>(null);

let nextViewportId = 0;

const VIEWPORT_RENDER_PRIORITY = 1;

function CameraViewportRenderer({
  viewportsRef,
}: {
  viewportsRef: MutableRefObject<Map<number, CameraViewportDescriptor>>;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const mainCamera = useThree((state) => state.camera);
  const mujoco = useMujoco();

  useFrame(() => {
    const drawWidth = gl.domElement.width;
    const drawHeight = gl.domElement.height;

    // We own the render now: draw the main scene full-frame first.
    gl.setScissorTest(false);
    gl.setViewport(0, 0, drawWidth, drawHeight);
    gl.render(scene, mainCamera);

    const api = mujoco.api;
    if (!api || viewportsRef.current.size === 0) return;

    const dpr = gl.getPixelRatio();
    const canvasRect = gl.domElement.getBoundingClientRect();

    for (const descriptor of viewportsRef.current.values()) {
      const element = descriptor.getElement();
      if (!element) continue;

      const rect = element.getBoundingClientRect();
      const isOffscreen =
        rect.bottom < canvasRect.top ||
        rect.top > canvasRect.bottom ||
        rect.right < canvasRect.left ||
        rect.left > canvasRect.right;
      if (isOffscreen) continue;

      const width = Math.floor(rect.width * dpr);
      const height = Math.floor(rect.height * dpr);
      if (width <= 0 || height <= 0) continue;

      const left = Math.floor((rect.left - canvasRect.left) * dpr);
      const bottom = Math.floor((canvasRect.bottom - rect.bottom) * dpr);

      let resolved: CameraFrameCaptureOptions;
      try {
        resolved = api.resolveCameraCaptureOptions(descriptor.getOptions());
      } catch {
        continue;
      }

      if (!descriptor.camera) {
        descriptor.camera = createCaptureCamera(resolved, mainCamera, width, height);
      } else {
        prepareCaptureCamera(descriptor.camera, resolved, mainCamera, width, height);
      }

      gl.setViewport(left, bottom, width, height);
      gl.setScissor(left, bottom, width, height);
      gl.setScissorTest(true);
      gl.render(scene, descriptor.camera);
    }

    gl.setScissorTest(false);
    gl.setViewport(0, 0, drawWidth, drawHeight);
  }, VIEWPORT_RENDER_PRIORITY);

  return null;
}

/**
 * Provides the live-viewport registry and mounts the managed render loop only
 * while at least one viewport is active. Mounted internally by the MuJoCo
 * provider; you do not need to add it yourself.
 */
export function CameraViewportProvider({ children }: { children?: ReactNode }) {
  const viewportsRef = useRef<Map<number, CameraViewportDescriptor>>(new Map());
  const [count, setCount] = useState(0);

  const register = useCallback((descriptor: CameraViewportDescriptor) => {
    const id = nextViewportId++;
    viewportsRef.current.set(id, descriptor);
    setCount((value) => value + 1);
    return () => {
      viewportsRef.current.delete(id);
      setCount((value) => value - 1);
    };
  }, []);

  const value = useMemo<CameraViewportRegistry>(() => ({ register }), [register]);

  return (
    <CameraViewportRegistryContext.Provider value={value}>
      {children}
      {count > 0 && <CameraViewportRenderer viewportsRef={viewportsRef} />}
    </CameraViewportRegistryContext.Provider>
  );
}

/**
 * Render the live MuJoCo scene from a named camera into the region covered by
 * `elementRef`'s DOM element. Call this inside `<MujocoCanvas>` with a ref to a
 * DOM element you position anywhere (it does not need to be in the R3F tree).
 */
export function useCameraViewport<T extends HTMLElement = HTMLElement>(
  elementRef: RefObject<T | null>,
  options: CameraViewportOptions
) {
  const registry = useContext(CameraViewportRegistryContext);
  if (!registry) {
    throw new Error('useCameraViewport must be used inside <MujocoCanvas>.');
  }

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const descriptor: CameraViewportDescriptor = {
      getElement: () => elementRef.current,
      getOptions: () => optionsRef.current,
      camera: null,
    };
    return registry.register(descriptor);
  }, [registry, elementRef]);
}

export interface CameraViewProps extends CameraViewportOptions {
  className?: string;
  style?: CSSProperties;
}

/**
 * Drop-in live camera pane. Renders an absolutely-positioned overlay `<div>`
 * over the canvas showing the selected MuJoCo camera. Position it with
 * `style`/`className` (the canvas's parent should be positioned).
 */
export function CameraView({ className, style, ...options }: CameraViewProps) {
  const gl = useThree((state) => state.gl);
  const elementRef = useRef<HTMLDivElement | null>(null);
  if (!elementRef.current && typeof document !== 'undefined') {
    elementRef.current = document.createElement('div');
  }

  useEffect(() => {
    const element = elementRef.current;
    const parent = gl.domElement.parentElement;
    if (!element || !parent) return;
    element.style.position = 'absolute';
    element.style.overflow = 'hidden';
    parent.appendChild(element);
    return () => {
      parent.removeChild(element);
    };
  }, [gl]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.className = className ?? '';
    if (style) Object.assign(element.style, style);
  }, [className, style]);

  useCameraViewport(elementRef, options);

  return null;
}

export type { Bodies, Cameras, Sites };
