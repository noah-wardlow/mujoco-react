/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ContactMarkers — instanced sphere visualization of MuJoCo contacts (spec 6.2)
 *
 * Fixed from original: reads data.ncon first, accesses contact via .get(i),
 * limits to maxContacts to avoid WASM heap OOM.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMujocoSim } from '../core/MujocoSimProvider';

const _dummy = new THREE.Object3D();

interface ContactMarkersProps {
  /** Maximum contacts to render. Default: 100. */
  maxContacts?: number;
  /** Sphere radius. Default: 0.005. */
  radius?: number;
  /** Color. Default: '#4f46e5'. */
  color?: string;
  /** Show markers. Default: true. */
  visible?: boolean;
}

export function ContactMarkers({
  maxContacts = 100,
  radius = 0.005,
  color = '#4f46e5',
  visible = true,
}: ContactMarkersProps = {}) {
  const { mjDataRef, status } = useMujocoSim();
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    const data = mjDataRef.current;
    if (!mesh || !data || !visible) {
      if (mesh) mesh.count = 0;
      return;
    }

    const ncon = data.ncon;
    const count = Math.min(ncon, maxContacts);

    for (let i = 0; i < count; i++) {
      try {
        const c = (data.contact as { get(i: number): { pos: Float64Array } | undefined }).get(i);
        if (!c) break;
        _dummy.position.set(c.pos[0], c.pos[1], c.pos[2]);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
      } catch {
        // Contact access failed — stop here
        mesh.count = i;
        mesh.instanceMatrix.needsUpdate = true;
        return;
      }
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (status !== 'ready') return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxContacts]}>
      <sphereGeometry args={[radius, 8, 8]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.3}
        roughness={0.5}
      />
    </instancedMesh>
  );
}
