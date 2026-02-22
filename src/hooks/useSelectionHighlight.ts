/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useSelectionHighlight — convenience hook for emissive body highlights.
 *
 * Built on useBodyMeshes. For custom visuals, use useBodyMeshes directly.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useBodyMeshes } from './useBodyMeshes';

export function useSelectionHighlight(
  bodyId: number | null,
  options: { color?: string; emissiveIntensity?: number } = {},
) {
  const { color = '#ff4444', emissiveIntensity = 0.3 } = options;
  const meshes = useBodyMeshes(bodyId);
  const prevRef = useRef<{ mesh: THREE.Mesh; originalEmissive: THREE.Color; originalIntensity: number }[]>([]);

  useEffect(() => {
    // Restore previous
    for (const entry of prevRef.current) {
      const mat = entry.mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) {
        mat.emissive.copy(entry.originalEmissive);
        mat.emissiveIntensity = entry.originalIntensity;
      }
    }
    prevRef.current = [];

    // Apply new
    const highlightColor = new THREE.Color(color);
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) {
        prevRef.current.push({
          mesh,
          originalEmissive: mat.emissive.clone(),
          originalIntensity: mat.emissiveIntensity ?? 0,
        });
        mat.emissive.copy(highlightColor);
        mat.emissiveIntensity = emissiveIntensity;
      }
    }

    return () => {
      for (const entry of prevRef.current) {
        const mat = entry.mesh.material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.copy(entry.originalEmissive);
          mat.emissiveIntensity = entry.originalIntensity;
        }
      }
      prevRef.current = [];
    };
  }, [meshes, color, emissiveIntensity]);
}
