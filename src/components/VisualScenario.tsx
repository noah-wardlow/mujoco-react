/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useThree } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SplatEnvironmentReadinessStatus } from '../types';
import type {
  PairedSplatEnvironmentConfig,
  ScenarioMaterialConfig,
  SceneConfig,
  SplatCollisionProxyConfig,
  SplatEnvironmentReadiness,
  SplatEnvironmentMetadata,
  SplatEnvironmentMetadataInput,
  SplatFormat,
  SplatRendererKind,
  SplatSceneConfigInput,
  SplatSceneConfigState,
  SplatSceneInput,
  ScenarioLightingPreset,
  ScenarioLightingProps,
  SplatEnvironmentProps,
  VisualScenarioConfig,
  VisualScenarioEffectsProps,
} from '../types';

const DEFAULT_BACKGROUND = '#181a1f';

export function ScenarioLighting({
  preset = 'studio',
  castShadow = true,
  intensity = 1,
}: ScenarioLightingProps) {
  if (preset === 'warehouse') {
    return (
      <>
        <ambientLight intensity={0.18 * intensity} />
        <directionalLight
          position={[3.5, -2, 5]}
          intensity={2.2 * intensity}
          castShadow={castShadow}
        />
        <directionalLight position={[-2, 1.5, 2.5]} intensity={0.25 * intensity} />
      </>
    );
  }

  if (preset === 'low-light') {
    return (
      <>
        <ambientLight intensity={0.08 * intensity} />
        <directionalLight
          position={[2, -2, 3]}
          intensity={0.75 * intensity}
          castShadow={castShadow}
        />
        <pointLight position={[-0.5, -0.8, 1.3]} intensity={0.6 * intensity} />
      </>
    );
  }

  if (preset === 'splat') {
    return (
      <>
        <ambientLight intensity={0.42 * intensity} />
        <directionalLight
          position={[1.8, -2.4, 3.5]}
          intensity={1.2 * intensity}
          castShadow={castShadow}
        />
        <pointLight position={[0.4, 0.2, 1.4]} intensity={0.35 * intensity} />
      </>
    );
  }

  return (
    <>
      <ambientLight intensity={0.35 * intensity} />
      <directionalLight
        position={[2.5, -3, 4]}
        intensity={1.6 * intensity}
        castShadow={castShadow}
      />
    </>
  );
}

export function getScenarioBackground(
  preset: ScenarioLightingPreset | undefined,
  fallback = DEFAULT_BACKGROUND
) {
  if (preset === 'warehouse') return '#20242b';
  if (preset === 'low-light') return '#0f1115';
  if (preset === 'splat') return '#1b1f24';
  return fallback;
}

export function getScenarioCameraPosition(
  basePosition: readonly [number, number, number],
  scenario?: Pick<VisualScenarioConfig, 'camera'>
): [number, number, number] {
  const [x, y, z] = basePosition;
  const jitter = scenario?.camera?.jitter ?? 0;

  return [
    Number((x + jitter * 0.6).toFixed(3)),
    Number((y - jitter * 0.4).toFixed(3)),
    Number((z + jitter * 0.25).toFixed(3)),
  ];
}

export function VisualScenarioEffects(props: VisualScenarioEffectsProps) {
  useVisualScenarioEffects(props);
  return null;
}

export function useVisualScenarioEffects({
  scenario,
  enabled = true,
  applyBackground = true,
  applyFog = true,
  applyRenderer = true,
  applyMaterials = true,
  background,
  fogNear,
  fogFar,
  materialFilter,
}: VisualScenarioEffectsProps) {
  const { gl, scene, invalidate } = useThree();

  useEffect(() => {
    if (!enabled || !scenario) {
      return undefined;
    }

    const previousExposure = gl.toneMappingExposure;
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    const materialSnapshots = new Map<
      THREE.Material,
      {
        color?: THREE.Color;
        roughness?: number;
        metalness?: number;
      }
    >();

    if (applyRenderer) {
      gl.toneMappingExposure = scenario.camera?.exposure ?? 1;
    }

    if (applyBackground) {
      scene.background = new THREE.Color(
        background ?? getScenarioBackground(scenario.lighting)
      );
    }

    if (applyFog) {
      scene.fog = createScenarioFog(scenario, background, fogNear, fogFar);
    }

    if (applyMaterials && scenario.materials) {
      applyScenarioMaterials(scene, scenario, materialSnapshots, materialFilter);
    }

    invalidate();

    return () => {
      gl.toneMappingExposure = previousExposure;
      scene.background = previousBackground;
      scene.fog = previousFog;

      for (const [material, snapshot] of materialSnapshots) {
        const mutable = getMutableScenarioMaterial(material);
        if (!mutable) continue;
        if (snapshot.color) mutable.color.copy(snapshot.color);
        if (typeof snapshot.roughness === 'number') {
          mutable.roughness = snapshot.roughness;
        }
        if (typeof snapshot.metalness === 'number') {
          mutable.metalness = snapshot.metalness;
        }
        mutable.needsUpdate = true;
      }

      invalidate();
    };
  }, [
    applyBackground,
    applyFog,
    applyMaterials,
    applyRenderer,
    background,
    enabled,
    fogFar,
    fogNear,
    gl,
    invalidate,
    materialFilter,
    scenario,
    scene,
  ]);
}

/**
 * Renderer-agnostic Gaussian splat environment boundary.
 *
 * This component intentionally does not import a specific 3DGS renderer. Pass a
 * Spark/GaussianSplats3D object as `children` once the app chooses a renderer,
 * and pass MuJoCo/MJCF collision proxy visuals via `collisionProxy`.
 */
export function SplatEnvironment({
  environment,
  scenario,
  renderer,
  src,
  format,
  collisionProxy,
  collisionProxyMetadata,
  children,
  showPlaceholder = true,
  ...groupProps
}: SplatEnvironmentProps) {
  const metadata = useSplatEnvironment({
    environment,
    scenario,
    renderer,
    src,
    format,
    collisionProxy: collisionProxyMetadata,
  });
  const existingUserData =
    typeof groupProps.userData === 'object' && groupProps.userData !== null
      ? groupProps.userData
      : {};

  return (
    <group
      {...groupProps}
      userData={{
        ...existingUserData,
        ...metadata.userData,
      }}
    >
      {children}
      {children || !showPlaceholder ? null : <SplatPlaceholder />}
      {collisionProxy}
    </group>
  );
}

export function useSplatEnvironment({
  environment,
  scenario,
  renderer,
  src,
  format,
  collisionProxy,
}: SplatEnvironmentMetadataInput): SplatEnvironmentMetadata {
  const scenarioEnvironment = useMemo(
    () =>
      environment ??
      (scenario
        ? createPairedSplatEnvironment(scenario, { renderer })
        : undefined),
    [environment, renderer, scenario]
  );
  const resolvedSrc = src ?? scenarioEnvironment?.splat.src ?? scenario?.splat?.src;
  const resolvedFormat =
    format ??
    scenarioEnvironment?.splat.format ??
    scenario?.splat?.format ??
    'spz';
  const resolvedCollisionProxy =
    collisionProxy ??
    scenarioEnvironment?.collisionProxy ??
    scenario?.splat?.collisionProxy ??
    undefined;
  const readiness = useMemo(
    () =>
      getSplatEnvironmentReadiness({
        environment: scenarioEnvironment,
        scenario,
        renderer,
        src: resolvedSrc,
        format: resolvedFormat,
        collisionProxy: resolvedCollisionProxy,
      }),
    [
      collisionProxy,
      renderer,
      resolvedCollisionProxy,
      resolvedFormat,
      resolvedSrc,
      scenario,
      scenarioEnvironment,
    ]
  );

  return useMemo(
    () => ({
      src: resolvedSrc,
      format: resolvedFormat,
      collisionProxy: resolvedCollisionProxy,
      readiness,
      userData: createSplatEnvironmentUserData({
        environment: scenarioEnvironment,
        src: resolvedSrc,
        format: resolvedFormat,
        collisionProxy: resolvedCollisionProxy,
        readiness,
      }),
    }),
    [
      scenarioEnvironment,
      resolvedSrc,
      resolvedFormat,
      resolvedCollisionProxy,
      readiness,
    ]
  );
}

/**
 * Resolve a visual scenario's paired splat environment and compose its MJCF
 * collision proxy into a MuJoCo scene config.
 *
 * This hook is renderer-agnostic: apps can use it with Spark, another 3DGS
 * renderer, or their own Three scene objects while keeping physics collision
 * files paired with the visual splat metadata.
 */
export function useSplatSceneConfig({
  sceneConfig,
  scenario,
  environment,
  enabled = true,
  renderer,
}: SplatSceneConfigInput): SplatSceneConfigState {
  const resolvedEnvironment = useMemo(
    () =>
      enabled
        ? environment ??
          (scenario
            ? createPairedSplatEnvironment(scenario, { renderer })
            : undefined)
        : undefined,
    [enabled, environment, renderer, scenario]
  );
  const readiness = useMemo(
    () =>
      getSplatEnvironmentReadiness({
        environment: resolvedEnvironment,
        scenario,
        renderer,
        enabled,
      }),
    [enabled, renderer, resolvedEnvironment, scenario]
  );
  const resolvedSceneConfig = useMemo(
    () =>
      resolvedEnvironment
        ? withSplatEnvironment(sceneConfig, resolvedEnvironment)
        : sceneConfig,
    [resolvedEnvironment, sceneConfig]
  );

  return useMemo(
    () => ({
      environment: resolvedEnvironment,
      sceneConfig: resolvedSceneConfig,
      enabled: enabled && readiness.status !== SplatEnvironmentReadinessStatus.Disabled,
      readiness,
    }),
    [enabled, readiness, resolvedEnvironment, resolvedSceneConfig]
  );
}

export function getSplatEnvironmentReadiness({
  environment,
  scenario,
  renderer,
  src,
  format,
  collisionProxy,
  enabled = true,
}: {
  environment?: PairedSplatEnvironmentConfig;
  scenario?: Pick<VisualScenarioConfig, 'splat'>;
  renderer?: SplatRendererKind;
  src?: string;
  format?: SplatFormat;
  collisionProxy?: SplatCollisionProxyConfig;
  enabled?: boolean;
}): SplatEnvironmentReadiness {
  const splat = scenario?.splat;
  const resolvedSrc = src ?? environment?.splat.src ?? splat?.src;
  const resolvedFormat =
    format ?? environment?.splat.format ?? splat?.format ?? 'spz';
  const resolvedRenderer = renderer ?? environment?.splat.renderer;
  const resolvedCollisionProxy =
    collisionProxy ?? environment?.collisionProxy ?? splat?.collisionProxy ?? undefined;
  const requiresCollisionProxy = splat?.requiresCollisionProxy ?? true;

  if (!enabled || (splat && splat.enabled === false && !environment)) {
    return {
      status: SplatEnvironmentReadinessStatus.Disabled,
      ready: false,
      requiresCollisionProxy,
      missing: [],
      format: resolvedFormat,
      renderer: resolvedRenderer,
      message: 'Splat environment is disabled.',
    };
  }

  if (!resolvedSrc) {
    return {
      status: SplatEnvironmentReadinessStatus.MissingSplat,
      ready: false,
      requiresCollisionProxy,
      missing: ['splat'],
      format: resolvedFormat,
      renderer: resolvedRenderer,
      message: 'Splat environment is missing a visual asset source.',
    };
  }

  if (resolvedRenderer === 'spark' && resolvedFormat !== 'spz') {
    return {
      status: SplatEnvironmentReadinessStatus.UnsupportedFormat,
      ready: false,
      requiresCollisionProxy,
      missing: [],
      format: resolvedFormat,
      renderer: resolvedRenderer,
      message: `Spark splat rendering requires .spz assets; received ${resolvedFormat}.`,
    };
  }

  if (requiresCollisionProxy && !resolvedCollisionProxy?.xmlPath) {
    return {
      status: SplatEnvironmentReadinessStatus.MissingCollisionProxy,
      ready: false,
      requiresCollisionProxy,
      missing: ['collisionProxy'],
      format: resolvedFormat,
      renderer: resolvedRenderer,
      message: 'Splat environment is missing paired MJCF collision proxy XML.',
    };
  }

  return {
    status: SplatEnvironmentReadinessStatus.Ready,
    ready: true,
    requiresCollisionProxy,
    missing: [],
    format: resolvedFormat,
    renderer: resolvedRenderer,
    message: requiresCollisionProxy
      ? 'Splat environment has visual asset and collision proxy metadata.'
      : 'Splat environment has a visual asset and does not require collision proxy metadata.',
  };
}

/**
 * Convert a generic visual scenario splat block into a composable splat
 * environment config. Visual-only splats are valid; readiness reports whether
 * a paired MJCF collision proxy is required before training/physics handoff.
 */
export function createPairedSplatEnvironment(
  scenario: Pick<VisualScenarioConfig, 'id' | 'label' | 'environment' | 'splat'>,
  options: {
    id?: string;
    label?: string;
    description?: string;
    renderer?: SplatRendererKind;
  } = {}
): PairedSplatEnvironmentConfig | undefined {
  const splat = scenario.splat;
  const collisionProxy = splat?.collisionProxy;

  if (!splat?.enabled || !splat.src) {
    return undefined;
  }

  return {
    id: options.id ?? scenario.id ?? 'splat-environment',
    label: options.label ?? scenario.label ?? 'Gaussian splat environment',
    description:
      options.description ??
      (scenario.environment
        ? `Visual ${scenario.environment} splat paired with MJCF collision proxy.`
        : undefined),
    splat: {
      src: splat.src,
      format: splat.format ?? 'spz',
      renderer: options.renderer,
    },
    collisionProxy: collisionProxy?.xmlPath
      ? {
          ...collisionProxy,
          xmlPath: collisionProxy.xmlPath,
        }
      : undefined,
  };
}

function isPairedSplatEnvironment(input: SplatSceneInput): input is PairedSplatEnvironmentConfig {
  return (
    !!input &&
    'splat' in input &&
    !!input.splat &&
    !('enabled' in input.splat)
  );
}

function sceneRelativePath(sceneConfig: SceneConfig, path: string): string {
  const src = sceneConfig.src;
  if (!src) return path;

  const base = src.endsWith('/') ? src : src + '/';
  if (path.startsWith(base)) return path.slice(base.length);
  return path;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

/**
 * Compose a MuJoCo scene config with a paired splat collision proxy.
 *
 * This keeps the common hybrid setup declarative:
 * robot XML remains `sceneFile`, the `.spz` remains a visual-only layer, and
 * the paired MJCF collision proxy is added to `environmentFiles`.
 */
export function withSplatEnvironment(
  sceneConfig: SceneConfig,
  input: SplatSceneInput,
  options: { renderer?: SplatRendererKind } = {}
): SceneConfig {
  const environment = isPairedSplatEnvironment(input)
    ? input
    : input
      ? createPairedSplatEnvironment(input, options)
      : undefined;
  const xmlPath = environment?.collisionProxy?.xmlPath;
  if (!xmlPath) return sceneConfig;

  return {
    ...sceneConfig,
    environmentFiles: uniquePaths([
      ...(sceneConfig.environmentFiles ?? []),
      sceneRelativePath(sceneConfig, xmlPath),
    ]),
  };
}

export function createSplatEnvironmentUserData({
  environment,
  src,
  format = 'spz',
  collisionProxy,
  readiness,
}: {
  environment?: PairedSplatEnvironmentConfig;
  src?: string;
  format?: SplatFormat;
  collisionProxy?: SplatCollisionProxyConfig;
  readiness?: SplatEnvironmentReadiness;
}) {
  return {
    role: 'splat-environment',
    environmentId: environment?.id,
    environmentLabel: environment?.label,
    splatSrc: src,
    splatFormat: format,
    splatRenderer: environment?.splat.renderer,
    collisionProxyStatus: collisionProxy?.status ?? 'missing',
    collisionProxyXmlPath: collisionProxy?.xmlPath,
    collisionProxyPrimitives: collisionProxy?.primitives ?? [],
    readinessStatus: readiness?.status,
    readinessMessage: readiness?.message,
  };
}

export function createSparkSplatViewerUrl({
  viewerUrl,
  splatSrc,
}: {
  viewerUrl: string;
  splatSrc: string;
}) {
  const url = new URL(viewerUrl, 'http://mujoco-react.local');
  url.searchParams.set('splat', splatSrc);
  return viewerUrl.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
}

function SplatPlaceholder() {
  return (
    <group>
      <mesh position={[0, 0, 1.2]}>
        <boxGeometry args={[2.4, 2.4, 2.4]} />
        <meshBasicMaterial
          color="#8b8b8b"
          transparent
          opacity={0.06}
          wireframe
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function createScenarioFog(
  scenario: VisualScenarioConfig,
  background: THREE.ColorRepresentation | undefined,
  fogNear: number | undefined,
  fogFar: number | undefined
) {
  if (scenario.lighting === 'low-light') {
    return new THREE.Fog(
      background ?? getScenarioBackground(scenario.lighting),
      fogNear ?? 2.5,
      fogFar ?? 9
    );
  }

  if (scenario.lighting === 'warehouse') {
    return new THREE.Fog(
      background ?? getScenarioBackground(scenario.lighting),
      fogNear ?? 5,
      fogFar ?? 16
    );
  }

  return null;
}

function applyScenarioMaterials(
  scene: THREE.Scene,
  scenario: VisualScenarioConfig,
  snapshots: Map<
    THREE.Material,
    {
      color?: THREE.Color;
      roughness?: number;
      metalness?: number;
    }
  >,
  materialFilter: VisualScenarioEffectsProps['materialFilter']
) {
  const materials = scenario.materials;
  if (!materials) return;

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    for (const material of normalizeMaterials(object.material)) {
      const mutable = getMutableScenarioMaterial(material);
      if (!mutable) continue;
      if (materialFilter && !materialFilter({ object, material })) continue;

      if (!snapshots.has(material)) {
        snapshots.set(material, {
          color: mutable.color.clone(),
          roughness: mutable.roughness,
          metalness: mutable.metalness,
        });
      }

      applyScenarioMaterial(mutable, object, scenario, materials);
    }
  });
}

function applyScenarioMaterial(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  object: THREE.Object3D,
  scenario: VisualScenarioConfig,
  materials: ScenarioMaterialConfig
) {
  const seed = scenario.seed ?? 0;
  const objectKey = `${scenario.id ?? 'scenario'}:${object.name}:${material.name}:${seed}`;
  const variation = hashToUnitInterval(objectKey);

  if (materials.randomizeObjectColors) {
    material.color.setHSL(variation, 0.38, 0.42);
  }

  if (materials.randomizeTableMaterial) {
    material.roughness = clamp01(
      materials.roughness ?? 0.35 + variation * 0.45
    );
    material.metalness = clamp01(
      materials.metalness ?? variation * 0.12
    );
  }

  material.needsUpdate = true;
}

function normalizeMaterials(
  material: THREE.Material | THREE.Material[]
): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function getMutableScenarioMaterial(
  material: THREE.Material
): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | null {
  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  ) {
    return material;
  }

  return null;
}

function hashToUnitInterval(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export type SplatCollisionProxy = ReactNode | ThreeElements['group'];
