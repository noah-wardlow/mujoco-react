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

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { useMujocoContext } from '../core/MujocoSimProvider';

const DEFAULT_TENDON_COLOR = new THREE.Color(0.3, 0.3, 0.8);
const DEFAULT_TENDON_WIDTH = 0.002;

// Preallocated temp vector to avoid per-frame allocations
const _tmpVec = new THREE.Vector3();

export function TendonRenderer(props: Omit<ThreeElements['group'], 'ref'>) {
  const { mjModelRef, mjDataRef, status } = useMujocoContext();
  const groupRef = useRef<THREE.Group>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const curvesRef = useRef<THREE.CatmullRomCurve3[]>([]);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

  // Build tendon meshes once when model loads
  useEffect(() => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    const group = groupRef.current;
    if (!model || !data || !group) return;

    const ntendon = model.ntendon ?? 0;
    if (ntendon === 0) return;

    // Shared material for all tendons
    const material = new THREE.MeshStandardMaterial({
      color: DEFAULT_TENDON_COLOR,
      roughness: 0.6,
      metalness: 0.1,
    });
    materialRef.current = material;

    const meshes: THREE.Mesh[] = [];
    const curves: THREE.CatmullRomCurve3[] = [];

    for (let t = 0; t < ntendon; t++) {
      const wrapNum = model.ten_wrapnum[t];
      if (wrapNum < 2) {
        meshes.push(null!);
        curves.push(null!);
        continue;
      }

      // Initial dummy points — will be overwritten in useFrame
      const points = Array.from({ length: wrapNum }, () => new THREE.Vector3());
      const curve = new THREE.CatmullRomCurve3(points, false);
      const segments = Math.max(wrapNum * 2, 4);
      const geometry = new THREE.TubeGeometry(curve, segments, DEFAULT_TENDON_WIDTH, 6, false);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes.push(mesh);
      curves.push(curve);
    }

    meshesRef.current = meshes;
    curvesRef.current = curves;

    return () => {
      for (const mesh of meshes) {
        if (!mesh) continue;
        group.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      meshesRef.current = [];
      curvesRef.current = [];
      materialRef.current = null;
    };
  }, [status, mjModelRef, mjDataRef]);

  // Update curve control points and rebuild geometry each frame
  useFrame(() => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    const ntendon = model.ntendon ?? 0;
    const meshes = meshesRef.current;
    const curves = curvesRef.current;

    for (let t = 0; t < ntendon; t++) {
      const mesh = meshes[t];
      const curve = curves[t];
      if (!mesh || !curve) continue;

      const wrapAdr = model.ten_wrapadr[t];
      const wrapNum = model.ten_wrapnum[t];

      // Update existing control points in-place
      let validCount = 0;
      for (let w = 0; w < wrapNum; w++) {
        const idx = (wrapAdr + w) * 3;
        if (data.wrap_xpos && idx + 2 < data.wrap_xpos.length) {
          const x = data.wrap_xpos[idx];
          const y = data.wrap_xpos[idx + 1];
          const z = data.wrap_xpos[idx + 2];
          if (x !== 0 || y !== 0 || z !== 0) {
            if (validCount < curve.points.length) {
              curve.points[validCount].set(x, y, z);
            }
            validCount++;
          }
        }
      }

      if (validCount < 2) {
        mesh.visible = false;
        continue;
      }

      // Trim or pad points array to match valid count
      if (curve.points.length !== validCount) {
        curve.points.length = validCount;
        while (curve.points.length < validCount) {
          curve.points.push(new THREE.Vector3());
        }
      }

      // Rebuild geometry from updated curve
      mesh.geometry.dispose();
      mesh.geometry = new THREE.TubeGeometry(
        curve, Math.max(validCount * 2, 4), DEFAULT_TENDON_WIDTH, 6, false
      );
      mesh.visible = true;
    }
  });

  if (status !== 'ready') return null;
  return <group {...props} ref={groupRef} />;
}
