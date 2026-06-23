/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import {
  SplatEnvironment,
  useSplatEnvironment,
  useSplatSceneConfig,
} from './components/VisualScenario';
import {
  CAMERA_FRAME_CAPTURE_RENDER_USER_DATA_KEY,
} from './rendering/cameraFrameCapture';
import type {
  CameraFrameCaptureRenderInput,
  CameraFrameCaptureRenderResult,
} from './rendering/cameraFrameCapture';
import type {
  PairedSplatEnvironmentConfig,
  SceneConfig,
  SplatEnvironmentProps,
  SplatEnvironmentReadiness,
  VisualScenarioConfig,
} from './types';

type SparkModule = typeof import('@sparkjsdev/spark');
type SparkRendererInstance = InstanceType<SparkModule['SparkRenderer']>;
type SparkSplatMeshInstance = InstanceType<SparkModule['SplatMesh']>;
type SparkDisposable = {
  dispose?: () => unknown;
};
type SparkCaptureRenderer = {
  renderer: SparkRendererInstance;
  width: number;
  height: number;
};
type SparkWorkerMessage = {
  reject?: (error: unknown) => void;
};
type SparkWorkerLike = {
  messages?: Record<string, SparkWorkerMessage>;
};
type SparkResourceWithWorkers = SparkDisposable & {
  worker?: SparkWorkerLike;
  sortWorker?: SparkWorkerLike;
  lodWorker?: SparkWorkerLike;
};

export type SparkSplatStatus = 'idle' | 'loading' | 'ready' | 'error';

let sparkDisposeRejectionHandlerRegistered = false;

export interface SparkSplatRenderTuning {
  /** Scale Spark's LoD splat budget for the live viewport. */
  lodSplatScale?: number;
  /** Minimum rendered LoD splat size. Higher values trade detail for speed. */
  lodRenderScale?: number;
  /** Minimum delay between Spark sort passes for the live viewport. */
  minSortIntervalMs?: number;
}

export interface SparkSplatCaptureTuning extends SparkSplatRenderTuning {
  /** Maximum animation frames to wait for first-capture Spark warm-up. Default: 4. */
  maxWarmupFrames?: number;
  /** Number of pixels sampled when deciding whether a capture is blank. Default: 512. */
  blankSampleCount?: number;
  /** Alpha threshold used by the blank-capture detector. Default: 8. */
  blankAlphaThreshold?: number;
  /** Minimum visible sampled-pixel ratio before retrying capture. Default: 0.02. */
  blankVisibleRatio?: number;
  /** Minimum average sampled RGB sum before retrying capture. Default: 3. */
  blankAverageColor?: number;
}

type ResolvedSparkSplatCaptureTuning = Required<
  Pick<
    SparkSplatCaptureTuning,
    | 'maxWarmupFrames'
    | 'blankSampleCount'
    | 'blankAlphaThreshold'
    | 'blankVisibleRatio'
    | 'blankAverageColor'
  >
> &
  SparkSplatRenderTuning;

function getDefaultLiveRenderTuning(
  lod: SparkSplatEnvironmentProps['lod']
): SparkSplatRenderTuning {
  return {
    lodSplatScale: lod === false ? undefined : lod === 'quality' ? 1 : 0.6,
    lodRenderScale: lod === false || lod === 'quality' ? undefined : 1.2,
    minSortIntervalMs: lod === false ? 0 : lod === 'quality' ? 32 : 80,
  };
}

function getDefaultCaptureTuning(
  lod: SparkSplatEnvironmentProps['lod']
): ResolvedSparkSplatCaptureTuning {
  return {
    lodSplatScale: lod === false ? undefined : lod === 'quality' ? 1.25 : 1.15,
    lodRenderScale: lod === false ? undefined : 0.6,
    minSortIntervalMs: 0,
    maxWarmupFrames: 4,
    blankSampleCount: 512,
    blankAlphaThreshold: 8,
    blankVisibleRatio: 0.02,
    blankAverageColor: 3,
  };
}

function resolveRenderTuning(
  defaults: SparkSplatRenderTuning,
  tuning: SparkSplatRenderTuning | undefined
): SparkSplatRenderTuning {
  return {
    lodSplatScale: tuning?.lodSplatScale ?? defaults.lodSplatScale,
    lodRenderScale: tuning?.lodRenderScale ?? defaults.lodRenderScale,
    minSortIntervalMs: tuning?.minSortIntervalMs ?? defaults.minSortIntervalMs,
  };
}

function resolveCaptureTuning(
  lod: SparkSplatEnvironmentProps['lod'],
  tuning: SparkSplatCaptureTuning | undefined
): ResolvedSparkSplatCaptureTuning {
  const defaults = getDefaultCaptureTuning(lod);
  return {
    ...resolveRenderTuning(defaults, tuning),
    maxWarmupFrames: tuning?.maxWarmupFrames ?? defaults.maxWarmupFrames,
    blankSampleCount: tuning?.blankSampleCount ?? defaults.blankSampleCount,
    blankAlphaThreshold:
      tuning?.blankAlphaThreshold ?? defaults.blankAlphaThreshold,
    blankVisibleRatio: tuning?.blankVisibleRatio ?? defaults.blankVisibleRatio,
    blankAverageColor: tuning?.blankAverageColor ?? defaults.blankAverageColor,
  };
}

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isMostlyBlankCapture(
  pixels: Uint8Array,
  tuning: ResolvedSparkSplatCaptureTuning
) {
  const sampleCount = Math.max(1, Math.floor(tuning.blankSampleCount));
  const stride = Math.max(4, Math.floor(pixels.length / sampleCount / 4) * 4);
  let sampled = 0;
  let visible = 0;
  let colorTotal = 0;

  for (let i = 0; i < pixels.length; i += stride) {
    const alpha = pixels[i + 3];
    const color = pixels[i] + pixels[i + 1] + pixels[i + 2];
    sampled += 1;
    if (alpha > tuning.blankAlphaThreshold) visible += 1;
    colorTotal += color;
  }

  if (sampled === 0) return true;
  return (
    visible / sampled < tuning.blankVisibleRatio ||
    colorTotal / sampled < tuning.blankAverageColor
  );
}

export interface SparkSplatLifecycle {
  status: SparkSplatStatus;
  error: Error | null;
  isLoading: boolean;
  isReady: boolean;
  isError: boolean;
  props: Pick<SparkSplatEnvironmentProps, 'onStatusChange' | 'onError'>;
  reset: () => void;
}

export interface SparkSplatEnvironmentState {
  environment: PairedSplatEnvironmentConfig | undefined;
  sceneConfig: SceneConfig;
  readiness: SplatEnvironmentReadiness;
  lifecycle: SparkSplatLifecycle;
  props: Pick<
    SparkSplatEnvironmentProps,
    'environment' | 'scenario' | 'src' | 'format' | 'onStatusChange' | 'onError'
  >;
  enabled: boolean;
}

export interface SparkSplatEnvironmentProps extends SplatEnvironmentProps {
  /** Enable Spark LoD handling for large splat assets. Default: true. */
  lod?: boolean | 'quality';
  /** Tune Spark's live viewport renderer. Defaults favor interactive FPS. */
  renderTuning?: SparkSplatRenderTuning;
  /** Tune Spark camera-frame capture. Defaults favor sharper snapshots. */
  captureTuning?: SparkSplatCaptureTuning;
  /**
   * Hide meshes whose names include floor, ground, or plane while the splat is
   * active. This mirrors the common hybrid-rendering setup where MJCF keeps
   * collision geometry but the splat owns the visual environment.
   */
  hideGroundMeshes?: boolean;
  onStatusChange?: (status: SparkSplatStatus) => void;
  onLoad?: (mesh: SparkSplatMeshInstance) => void;
  onError?: (error: Error) => void;
}

/**
 * Resolve a visual scenario's paired splat environment, compose its MJCF
 * collision proxy into the MuJoCo scene config, and expose Spark lifecycle
 * props for `<SparkSplatEnvironment />`.
 */
export function useSparkSplatEnvironment({
  sceneConfig,
  scenario,
  environment,
  enabled = true,
  renderer = 'spark',
  onError,
  onStatusChange,
}: {
  sceneConfig: SceneConfig;
  scenario?: VisualScenarioConfig;
  environment?: PairedSplatEnvironmentConfig;
  enabled?: boolean;
  renderer?: 'spark';
  onError?: (error: Error) => void;
  onStatusChange?: (status: SparkSplatStatus) => void;
}): SparkSplatEnvironmentState {
  const splatScene = useSplatSceneConfig({
    sceneConfig,
    scenario,
    environment,
    enabled,
    renderer,
  });
  const metadata = useSplatEnvironment({
    scenario,
    environment: splatScene.environment,
    renderer,
  });
  const renderEnabled = enabled && Boolean(metadata.src);
  const readiness = enabled ? metadata.readiness : splatScene.readiness;
  const lifecycle = useSparkSplatLifecycle({
    enabled: renderEnabled,
    onError,
    onStatusChange,
  });

  return useMemo(
    () => ({
      environment: splatScene.environment,
      sceneConfig: splatScene.sceneConfig,
      readiness,
      lifecycle,
      props: {
        environment: splatScene.environment,
        scenario: enabled ? scenario : undefined,
        src: enabled ? metadata.src : undefined,
        format: metadata.format,
        ...lifecycle.props,
      },
      enabled: renderEnabled,
    }),
    [enabled, lifecycle, metadata, readiness, renderEnabled, scenario, splatScene]
  );
}

/**
 * Tracks Spark 3DGS loading state for UI that wraps `SparkSplatEnvironment`.
 *
 * Use the returned `props` with `<SparkSplatEnvironment {...lifecycle.props} />`
 * to avoid repeating status/error state in app code.
 */
export function useSparkSplatLifecycle({
  enabled = true,
  initialStatus,
  onError,
  onStatusChange,
}: {
  enabled?: boolean;
  initialStatus?: SparkSplatStatus;
  onError?: (error: Error) => void;
  onStatusChange?: (status: SparkSplatStatus) => void;
} = {}): SparkSplatLifecycle {
  const [status, setStatus] = useState<SparkSplatStatus>(
    initialStatus ?? (enabled ? 'loading' : 'idle')
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus(enabled ? initialStatus ?? 'loading' : 'idle');
    setError(null);
  }, [enabled, initialStatus]);

  const handleStatusChange = useCallback(
    (nextStatus: SparkSplatStatus) => {
      setStatus(nextStatus);
      if (nextStatus !== 'error') {
        setError(null);
      }
      onStatusChange?.(nextStatus);
    },
    [onStatusChange]
  );

  const handleError = useCallback(
    (nextError: Error) => {
      setError(nextError);
      setStatus('error');
      onError?.(nextError);
    },
    [onError]
  );

  const reset = useCallback(() => {
    setStatus(enabled ? initialStatus ?? 'loading' : 'idle');
    setError(null);
  }, [enabled, initialStatus]);

  return useMemo(
    () => ({
      status,
      error,
      isLoading: status === 'loading',
      isReady: status === 'ready',
      isError: status === 'error',
      props: {
        onStatusChange: handleStatusChange,
        onError: handleError,
      },
      reset,
    }),
    [error, handleError, handleStatusChange, reset, status]
  );
}

/**
 * Optional SparkJS-backed Gaussian splat renderer for React Three Fiber scenes.
 *
 * Import from `mujoco-react/spark` and install `@sparkjsdev/spark` in the app
 * that uses it. The core `mujoco-react` entrypoint does not depend on Spark.
 */
export function SparkSplatEnvironment({
  environment,
  scenario,
  renderer = 'spark',
  src,
  format,
  collisionProxy,
  collisionProxyMetadata,
  showPlaceholder,
  children,
  lod = true,
  renderTuning,
  captureTuning,
  hideGroundMeshes = false,
  onStatusChange,
  onLoad,
  onError,
  ...groupProps
}: SparkSplatEnvironmentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sparkRef = useRef<SparkRendererInstance | null>(null);
  const captureSparkRef = useRef<SparkCaptureRenderer | null>(null);
  const meshRef = useRef<SparkSplatMeshInstance | null>(null);
  const hiddenMeshesRef = useRef<THREE.Mesh[]>([]);
  const onStatusChangeRef = useRef(onStatusChange);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const [status, setStatus] = useState<SparkSplatStatus>('idle');
  const { gl, invalidate } = useThree();
  onStatusChangeRef.current = onStatusChange;
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  const metadata = useSplatEnvironment({
    environment,
    scenario,
    renderer,
    src,
    format,
    collisionProxy: collisionProxyMetadata,
  });
  const resolvedRenderTuning = useMemo(
    () => resolveRenderTuning(getDefaultLiveRenderTuning(lod), renderTuning),
    [
      lod,
      renderTuning?.lodRenderScale,
      renderTuning?.lodSplatScale,
      renderTuning?.minSortIntervalMs,
    ]
  );
  const resolvedCaptureTuning = useMemo(
    () => resolveCaptureTuning(lod, captureTuning),
    [
      captureTuning?.blankAlphaThreshold,
      captureTuning?.blankAverageColor,
      captureTuning?.blankSampleCount,
      captureTuning?.blankVisibleRatio,
      captureTuning?.lodRenderScale,
      captureTuning?.lodSplatScale,
      captureTuning?.maxWarmupFrames,
      captureTuning?.minSortIntervalMs,
      lod,
    ]
  );

  useEffect(() => {
    let disposed = false;
    ensureSparkDisposeRejectionHandler();

    function setLifecycleStatus(nextStatus: SparkSplatStatus) {
      setStatus(nextStatus);
      onStatusChangeRef.current?.(nextStatus);
    }

    function restoreHiddenMeshes() {
      for (const mesh of hiddenMeshesRef.current) {
        mesh.visible = true;
      }
      hiddenMeshesRef.current = [];
    }

    function disposeCaptureSpark() {
      safelyDisposeSparkResource(captureSparkRef.current?.renderer);
      captureSparkRef.current = null;
    }

    async function loadSplat() {
      if (!metadata.src) {
        setLifecycleStatus('idle');
        return;
      }

      if (metadata.format !== 'spz') {
        const unsupportedFormatError = new Error(
          `SparkSplatEnvironment only supports .spz assets; received "${metadata.format}".`
        );
        setLifecycleStatus('error');
        onErrorRef.current?.(unsupportedFormatError);
        return;
      }

      setLifecycleStatus('loading');

      try {
        const sparkModule = await import('@sparkjsdev/spark');
        if (disposed || !groupRef.current) return;

        const spark = new sparkModule.SparkRenderer({
          renderer: gl,
          onDirty: invalidate,
          ...resolvedRenderTuning,
        });
        spark.userData[CAMERA_FRAME_CAPTURE_RENDER_USER_DATA_KEY] = async ({
          scene,
          camera,
          width,
          height,
        }: CameraFrameCaptureRenderInput): Promise<CameraFrameCaptureRenderResult> => {
          let captureSpark = captureSparkRef.current;
          if (
            !captureSpark ||
            captureSpark.width !== width ||
            captureSpark.height !== height
          ) {
            disposeCaptureSpark();
            captureSpark = {
              renderer: new sparkModule.SparkRenderer({
                renderer: gl,
                autoUpdate: false,
                lodSplatScale: resolvedCaptureTuning.lodSplatScale,
                lodRenderScale: resolvedCaptureTuning.lodRenderScale,
                minSortIntervalMs: resolvedCaptureTuning.minSortIntervalMs,
                target: {
                  width,
                  height,
                },
              }),
              width,
              height,
            };
            captureSparkRef.current = captureSpark;
          }

          const captureRenderer = captureSpark.renderer;
          const maxWarmupFrames = Math.max(
            1,
            Math.floor(resolvedCaptureTuning.maxWarmupFrames)
          );
          let pixels: Uint8Array | undefined;
          for (let attempt = 0; attempt < maxWarmupFrames; attempt += 1) {
            captureRenderer.renderSize.set(width, height);
            await captureRenderer.update({ scene, camera });
            pixels = await captureRenderer.renderReadTarget({
              scene,
              camera,
            });
            if (
              captureRenderer.activeSplats > 0 &&
              !isMostlyBlankCapture(pixels, resolvedCaptureTuning)
            ) {
              break;
            }
            if (attempt < maxWarmupFrames - 1) {
              await waitForNextAnimationFrame();
            }
          }
          if (!pixels) {
            throw new Error('Spark camera frame capture did not produce pixels.');
          }
          return { pixels, width, height, flipY: true };
        };
        const mesh = new sparkModule.SplatMesh({
          url: metadata.src,
          lod,
        });
        mesh.name = 'GaussianSplatMesh';

        groupRef.current.add(spark);
        groupRef.current.add(mesh);
        sparkRef.current = spark;
        meshRef.current = mesh;

        if (hideGroundMeshes && groupRef.current.parent) {
          groupRef.current.parent.traverse((object) => {
            if (
              !(object instanceof THREE.Mesh) ||
              object === (mesh as unknown as THREE.Object3D)
            ) {
              return;
            }
            const name = object.name.toLowerCase();
            if (
              name.includes('floor') ||
              name.includes('ground') ||
              name.includes('plane')
            ) {
              object.visible = false;
              hiddenMeshesRef.current.push(object);
            }
          });
        }

        await mesh.initialized;
        if (disposed) return;
        setLifecycleStatus('ready');
        onLoadRef.current?.(mesh);
        invalidate();
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error));
        setLifecycleStatus('error');
        onErrorRef.current?.(normalizedError);
      }
    }

    void loadSplat();

    return () => {
      disposed = true;
      restoreHiddenMeshes();

      if (meshRef.current) {
        groupRef.current?.remove(meshRef.current);
        safelyDisposeSparkResource(meshRef.current);
        meshRef.current = null;
      }

      if (sparkRef.current) {
        groupRef.current?.remove(sparkRef.current);
        safelyDisposeSparkResource(sparkRef.current);
        sparkRef.current = null;
      }

      disposeCaptureSpark();
    };
  }, [
    gl,
    hideGroundMeshes,
    invalidate,
    lod,
    metadata.format,
    metadata.src,
    resolvedCaptureTuning.blankAlphaThreshold,
    resolvedCaptureTuning.blankAverageColor,
    resolvedCaptureTuning.blankSampleCount,
    resolvedCaptureTuning.blankVisibleRatio,
    resolvedCaptureTuning.lodRenderScale,
    resolvedCaptureTuning.lodSplatScale,
    resolvedCaptureTuning.maxWarmupFrames,
    resolvedCaptureTuning.minSortIntervalMs,
    resolvedRenderTuning.lodRenderScale,
    resolvedRenderTuning.lodSplatScale,
    resolvedRenderTuning.minSortIntervalMs,
  ]);

  return (
    <SplatEnvironment
      {...groupProps}
      environment={environment}
      scenario={scenario}
      renderer={renderer}
      src={metadata.src}
      format={metadata.format}
      collisionProxyMetadata={metadata.collisionProxy}
      collisionProxy={collisionProxy}
      showPlaceholder={showPlaceholder ?? status !== 'ready'}
    >
      <group ref={groupRef} />
      {children}
    </SplatEnvironment>
  );
}

function safelyDisposeSparkResource(
  resource: SparkDisposable | null | undefined
) {
  if (!resource) return;
  try {
    silenceSparkWorkerTerminateRejections(resource);
    const result = resource.dispose?.();
    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(handleSparkDisposeError);
    }
  } catch (error) {
    handleSparkDisposeError(error);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function silenceSparkWorkerTerminateRejections(resource: SparkDisposable) {
  const workers = getSparkWorkers(resource);
  for (const worker of workers) {
    if (!worker.messages) continue;

    for (const message of Object.values(worker.messages)) {
      const reject = message.reject;
      if (!reject) continue;

      message.reject = (error: unknown) => {
        if (!isSparkWorkerTerminateError(error)) {
          reject(error);
        }
      };
    }
  }
}

function getSparkWorkers(resource: SparkDisposable): SparkWorkerLike[] {
  const sparkResource = resource as SparkResourceWithWorkers;
  return [
    sparkResource.worker,
    sparkResource.sortWorker,
    sparkResource.lodWorker,
  ].filter((worker): worker is SparkWorkerLike => Boolean(worker));
}

function handleSparkDisposeError(error: unknown) {
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('worker terminate')
  ) {
    return;
  }

  console.warn('[mujoco-react] Spark resource disposal failed.', error);
}

function ensureSparkDisposeRejectionHandler() {
  if (
    sparkDisposeRejectionHandlerRegistered ||
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function'
  ) {
    return;
  }

  sparkDisposeRejectionHandlerRegistered = true;
  window.addEventListener('unhandledrejection', (event) => {
    if (isSparkWorkerTerminateError(event.reason)) {
      event.preventDefault();
    }
  });
}

function isSparkWorkerTerminateError(reason: unknown) {
  return (
    reason instanceof Error &&
    reason.message.toLowerCase().includes('worker terminate')
  );
}
