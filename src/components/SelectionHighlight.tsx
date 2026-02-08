/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SelectionHighlight — highlight a selected body with emissive color (spec 6.5)
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SelectionHighlightProps } from '../types';

/**
 * Applies emissive highlight to all meshes belonging to a body.
 * Restores original emissive when bodyId changes or component unmounts.
 */
export function SelectionHighlight({
  bodyId,
  color = '#ff4444',
  emissiveIntensity = 0.3,
}: SelectionHighlightProps) {
  const { scene } = useThree();
  const prevMeshesRef = useRef<{ mesh: THREE.Mesh; originalEmissive: THREE.Color; originalIntensity: number }[]>([]);

  useEffect(() => {
    // Restore previous highlights
    for (const entry of prevMeshesRef.current) {
      const mat = entry.mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) {
        mat.emissive.copy(entry.originalEmissive);
        mat.emissiveIntensity = entry.originalIntensity;
      }
    }
    prevMeshesRef.current = [];

    if (bodyId === null || bodyId < 0) return;

    // Find all meshes belonging to this body
    const highlightColor = new THREE.Color(color);
    scene.traverse((obj) => {
      if (obj.userData.bodyID === bodyId && (obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          prevMeshesRef.current.push({
            mesh,
            originalEmissive: mat.emissive.clone(),
            originalIntensity: mat.emissiveIntensity ?? 0,
          });
          mat.emissive.copy(highlightColor);
          mat.emissiveIntensity = emissiveIntensity;
        }
      }
    });

    return () => {
      for (const entry of prevMeshesRef.current) {
        const mat = entry.mesh.material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.copy(entry.originalEmissive);
          mat.emissiveIntensity = entry.originalIntensity;
        }
      }
      prevMeshesRef.current = [];
    };
  }, [bodyId, color, emissiveIntensity, scene]);

  return null;
}
