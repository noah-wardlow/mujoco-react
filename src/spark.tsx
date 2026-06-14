/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  SplatEnvironment,
  useSplatEnvironment,
} from './components/VisualScenario';
import type {
  SplatEnvironmentProps,
} from './types';

type SparkModule = typeof import('@sparkjsdev/spark');
type SparkRendererInstance = InstanceType<SparkModule['SparkRenderer']>;
type SparkSplatMeshInstance = InstanceType<SparkModule['SplatMesh']>;

export type SparkSplatStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SparkSplatEnvironmentProps extends SplatEnvironmentProps {
  /** Enable Spark LoD handling for large splat assets. Default: true. */
  lod?: boolean | 'quality';
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
 * Optional SparkJS-backed Gaussian splat renderer for React Three Fiber scenes.
 *
 * Import from `mujoco-react/spark` and install `@sparkjsdev/spark` in the app
 * that uses it. The core `mujoco-react` entrypoint does not depend on Spark.
 */
export function SparkSplatEnvironment({
  environment,
  src,
  format,
  collisionProxy,
  collisionProxyMetadata,
  showPlaceholder,
  children,
  lod = true,
  hideGroundMeshes = false,
  onStatusChange,
  onLoad,
  onError,
  ...groupProps
}: SparkSplatEnvironmentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sparkRef = useRef<SparkRendererInstance | null>(null);
  const meshRef = useRef<SparkSplatMeshInstance | null>(null);
  const hiddenMeshesRef = useRef<THREE.Mesh[]>([]);
  const onStatusChangeRef = useRef(onStatusChange);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const [status, setStatus] = useState<SparkSplatStatus>('idle');
  const { gl, invalidate } = useThree();
  const metadata = useSplatEnvironment({
    environment,
    src,
    format,
    collisionProxy: collisionProxyMetadata,
  });

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let disposed = false;

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

    async function loadSplat() {
      if (!metadata.src || metadata.format !== 'spz') {
        setLifecycleStatus('idle');
        return;
      }

      setLifecycleStatus('loading');

      try {
        const sparkModule = await import('@sparkjsdev/spark');
        if (disposed || !groupRef.current) return;

        const spark = new sparkModule.SparkRenderer({
          renderer: gl,
          onDirty: invalidate,
        });
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
        meshRef.current.dispose?.();
        meshRef.current = null;
      }

      if (sparkRef.current) {
        groupRef.current?.remove(sparkRef.current);
        sparkRef.current.dispose?.();
        sparkRef.current = null;
      }
    };
  }, [
    gl,
    hideGroundMeshes,
    invalidate,
    lod,
    metadata.format,
    metadata.src,
  ]);

  return (
    <SplatEnvironment
      {...groupProps}
      environment={environment}
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
