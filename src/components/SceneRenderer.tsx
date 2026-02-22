/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GeomBuilder } from '../rendering/GeomBuilder';
import { MujocoModel } from '../types';
import { getName } from '../core/SceneLoader';
import { useMujocoSim } from '../core/MujocoSimProvider';

/**
 * SceneRenderer — creates and syncs MuJoCo body meshes every frame.
 * Accepts standard R3F group props (position, rotation, scale, visible, etc.).
 */
export function SceneRenderer(props: Omit<ThreeElements['group'], 'ref'>) {
  const { mjModelRef, mjDataRef, mujocoRef, onSelectionRef, status } = useMujocoSim();
  const groupRef = useRef<THREE.Group>(null);
  const bodyRefs = useRef<(THREE.Group | null)[]>([]);
  const prevModelRef = useRef<MujocoModel | null>(null);

  const geomBuilder = useMemo(() => {
    if (status !== 'ready') return null;
    return new GeomBuilder(mujocoRef.current);
  }, [status, mujocoRef]);

  // Build body groups when model loads
  useEffect(() => {
    if (status !== 'ready' || !geomBuilder) return;
    const model = mjModelRef.current;
    const group = groupRef.current;
    if (!model || !group) return;

    // Skip if model hasn't changed
    if (prevModelRef.current === model) return;
    prevModelRef.current = model;

    // Clear previous bodies
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    // Create body groups with geometry
    const refs: (THREE.Group | null)[] = [];
    for (let i = 0; i < model.nbody; i++) {
      const bodyGroup = new THREE.Group();
      bodyGroup.userData.bodyID = i;

      for (let g = 0; g < model.ngeom; g++) {
        if (model.geom_bodyid[g] === i) {
          const mesh = geomBuilder.create(model, g);
          if (mesh) bodyGroup.add(mesh);
        }
      }

      group.add(bodyGroup);
      refs.push(bodyGroup);
    }
    bodyRefs.current = refs;
  }, [status, geomBuilder, mjModelRef]);

  // Sync body positions from mjData every frame
  useFrame(() => {
    const data = mjDataRef.current;
    if (!data) return;
    const bodies = bodyRefs.current;
    for (let i = 0; i < bodies.length; i++) {
      const ref = bodies[i];
      if (!ref) continue;
      ref.position.set(
        data.xpos[i * 3],
        data.xpos[i * 3 + 1],
        data.xpos[i * 3 + 2]
      );
      ref.quaternion.set(
        data.xquat[i * 4 + 1],
        data.xquat[i * 4 + 2],
        data.xquat[i * 4 + 3],
        data.xquat[i * 4]
      );
    }
  });

  return (
    <group
      {...props}
      ref={groupRef}
      onDoubleClick={(e) => {
        if (typeof props.onDoubleClick === 'function') props.onDoubleClick(e);
        e.stopPropagation();
        let obj: THREE.Object3D | null = e.object;
        while (obj && obj.userData.bodyID === undefined && obj.parent) {
          obj = obj.parent;
        }
        const bodyID = obj?.userData.bodyID;
        if (typeof bodyID === 'number' && bodyID > 0) {
          const model = mjModelRef.current;
          if (model && bodyID < model.nbody && onSelectionRef.current) {
            const name = getName(model, model.name_bodyadr[bodyID]);
            onSelectionRef.current(bodyID, name);
          }
        }
      }}
    />
  );
}
