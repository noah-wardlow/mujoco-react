/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useBodyMeshes — returns Three.js meshes belonging to a MuJoCo body.
 *
 * Low-level primitive for custom selection visuals, outlines,
 * postprocessing effects, or any per-body mesh manipulation.
 */

import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Returns all Three.js meshes belonging to the given MuJoCo body ID.
 *
 * @example
 * ```tsx
 * const meshes = useBodyMeshes(selectedBodyId);
 *
 * // Use with drei Outline
 * <Outline selection={meshes} />
 *
 * // Or manipulate directly
 * useFrame(() => {
 *   meshes.forEach(m => { m.scale.setScalar(1.05); });
 * });
 * ```
 */
export function useBodyMeshes(bodyId: number | null): THREE.Mesh[] {
  const { scene } = useThree();

  return useMemo(() => {
    if (bodyId === null || bodyId < 0) return [];

    const meshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      if (obj.userData.bodyID === bodyId && (obj as THREE.Mesh).isMesh) {
        meshes.push(obj as THREE.Mesh);
      }
    });
    return meshes;
  }, [bodyId, scene]);
}
