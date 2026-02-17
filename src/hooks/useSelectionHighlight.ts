/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useSelectionHighlight — hook form of SelectionHighlight (spec 6.5)
 *
 * Applies emissive highlight to all meshes belonging to a body.
 * Restores original emissive when bodyId changes or hook unmounts.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function useSelectionHighlight(
  bodyId: number | null,
  options: { color?: string; emissiveIntensity?: number } = {},
) {
  const { color = '#ff4444', emissiveIntensity = 0.3 } = options;
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
}
