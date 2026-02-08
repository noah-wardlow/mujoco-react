/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TendonRenderer — render tendons as tube geometries (spec 6.4)
 *
 * WASM fields used: model.ntendon, model.ten_wrapadr, model.ten_wrapnum
 * data.wrap_xpos, data.ten_wrapadr (runtime)
 *
 * Note: ten_rgba and ten_width are NOT available in mujoco-js 0.0.7.
 * Tendons use a default color and width.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMujocoSim } from '../core/MujocoSimProvider';

const DEFAULT_TENDON_COLOR = new THREE.Color(0.3, 0.3, 0.8);
const DEFAULT_TENDON_WIDTH = 0.002;

export function TendonRenderer() {
  const { mjModelRef, mjDataRef, status } = useMujocoSim();
  const groupRef = useRef<THREE.Group>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);

  useFrame(() => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    const group = groupRef.current;
    if (!model || !data || !group) return;

    const ntendon = model.ntendon ?? 0;
    if (ntendon === 0) return;

    // Clean up old meshes
    for (const mesh of meshesRef.current) {
      group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    meshesRef.current = [];

    for (let t = 0; t < ntendon; t++) {
      const wrapAdr = model.ten_wrapadr[t];
      const wrapNum = model.ten_wrapnum[t];
      if (wrapNum < 2) continue;

      // Get wrap path points from data
      const points: THREE.Vector3[] = [];
      for (let w = 0; w < wrapNum; w++) {
        const idx = (wrapAdr + w) * 3;
        if (data.wrap_xpos && idx + 2 < data.wrap_xpos.length) {
          const x = data.wrap_xpos[idx];
          const y = data.wrap_xpos[idx + 1];
          const z = data.wrap_xpos[idx + 2];
          // Skip zero points (uninitialized wrap points)
          if (x !== 0 || y !== 0 || z !== 0) {
            points.push(new THREE.Vector3(x, y, z));
          }
        }
      }

      if (points.length < 2) continue;

      const curve = new THREE.CatmullRomCurve3(points, false);
      const geometry = new THREE.TubeGeometry(
        curve, Math.max(points.length * 2, 4), DEFAULT_TENDON_WIDTH, 6, false
      );

      const material = new THREE.MeshStandardMaterial({
        color: DEFAULT_TENDON_COLOR,
        roughness: 0.6,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      meshesRef.current.push(mesh);
    }
  });

  if (status !== 'ready') return null;
  return <group ref={groupRef} />;
}
