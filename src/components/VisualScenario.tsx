/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThreeElements } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import * as THREE from 'three';
import type {
  PairedSplatEnvironmentConfig,
  SplatCollisionProxyConfig,
  SplatEnvironmentMetadata,
  SplatEnvironmentMetadataInput,
  SplatFormat,
  ScenarioLightingPreset,
  ScenarioLightingProps,
  SplatEnvironmentProps,
  VisualScenarioConfig,
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

/**
 * Renderer-agnostic Gaussian splat environment boundary.
 *
 * This component intentionally does not import a specific 3DGS renderer. Pass a
 * Spark/GaussianSplats3D object as `children` once the app chooses a renderer,
 * and pass MuJoCo/MJCF collision proxy visuals via `collisionProxy`.
 */
export function SplatEnvironment({
  environment,
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
  src,
  format,
  collisionProxy,
}: SplatEnvironmentMetadataInput): SplatEnvironmentMetadata {
  const resolvedSrc = src ?? environment?.splat.src;
  const resolvedFormat = format ?? environment?.splat.format ?? 'spz';
  const resolvedCollisionProxy = collisionProxy ?? environment?.collisionProxy;

  return useMemo(
    () => ({
      src: resolvedSrc,
      format: resolvedFormat,
      collisionProxy: resolvedCollisionProxy,
      userData: createSplatEnvironmentUserData({
        environment,
        src: resolvedSrc,
        format: resolvedFormat,
        collisionProxy: resolvedCollisionProxy,
      }),
    }),
    [environment, resolvedSrc, resolvedFormat, resolvedCollisionProxy]
  );
}

export function createSplatEnvironmentUserData({
  environment,
  src,
  format = 'spz',
  collisionProxy,
}: {
  environment?: PairedSplatEnvironmentConfig;
  src?: string;
  format?: SplatFormat;
  collisionProxy?: SplatCollisionProxyConfig;
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

export type SplatCollisionProxy = ReactNode | ThreeElements['group'];
