/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FlexRenderer — render deformable flex bodies (spec 6.4)
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { getFlexTopology } from '../rendering/flexTopology';
import { useMujocoContext } from '../core/MujocoSimProvider';

/**
 * Renders MuJoCo flex (deformable) bodies as dynamic meshes.
 * Vertices are updated every frame from flexvert_xpos.
 */
export function FlexRenderer(props: Omit<ThreeElements['group'], 'ref'>) {
  const { mjModelRef, mjDataRef, status } = useMujocoContext();
  const groupRef = useRef<THREE.Group>(null);
  const meshesRef = useRef<Array<THREE.Mesh | THREE.LineSegments | THREE.Points>>([]);

  // Build flex meshes once when model is ready
  useEffect(() => {
    const model = mjModelRef.current;
    const group = groupRef.current;
    if (!model || !group || status !== 'ready') return;

    const nflex = model.nflex ?? 0;
    if (nflex === 0) return;

    for (let f = 0; f < nflex; f++) {
      const vertAdr = model.flex_vertadr[f];
      const vertNum = model.flex_vertnum[f];

      if (vertNum === 0) continue;

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(vertNum * 3);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const topology = getFlexTopology(model, f);
      if (topology.indices.length) geometry.setIndex(topology.indices);

      let color = new THREE.Color(0.5, 0.5, 0.5);
      if (model.flex_rgba) {
        color = new THREE.Color(
          model.flex_rgba[4 * f],
          model.flex_rgba[4 * f + 1],
          model.flex_rgba[4 * f + 2],
        );
      }

      const opacity = model.flex_rgba[4 * f + 3];
      const materialOptions = { color, opacity, transparent: opacity < 1 };
      const mesh = topology.kind === 'mesh'
        ? new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ ...materialOptions, roughness: 0.7, side: THREE.DoubleSide }))
        : topology.kind === 'lines'
          ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial(materialOptions))
          : new THREE.Points(geometry, new THREE.PointsMaterial({ ...materialOptions, size: 0.01 }));
      mesh.frustumCulled = false;
      mesh.userData.flexId = f;
      mesh.userData.vertAdr = vertAdr;
      mesh.userData.vertNum = vertNum;
      group.add(mesh);
      meshesRef.current.push(mesh);
    }

    return () => {
      for (const mesh of meshesRef.current) {
        group.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      meshesRef.current = [];
    };
  }, [status, mjModelRef]);

  // Update vertex positions every frame
  useFrame(() => {
    const data = mjDataRef.current;
    if (!data || !data.flexvert_xpos) return;

    for (const mesh of meshesRef.current) {
      const vertAdr = mesh.userData.vertAdr;
      const vertNum = mesh.userData.vertNum;
      const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (!posAttr) continue;

      for (let v = 0; v < vertNum; v++) {
        const srcIdx = (vertAdr + v) * 3;
        posAttr.setXYZ(v, data.flexvert_xpos[srcIdx], data.flexvert_xpos[srcIdx + 1], data.flexvert_xpos[srcIdx + 2]);
      }
      posAttr.needsUpdate = true;
      if (mesh instanceof THREE.Mesh) mesh.geometry.computeVertexNormals();
    }
  });

  if (status !== 'ready') return null;
  return <group {...props} ref={groupRef} />;
}
