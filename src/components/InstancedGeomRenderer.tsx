/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { getName } from '../core/SceneLoader';
import { GeomBuilder } from '../rendering/GeomBuilder';
import type { GeomInfo, MujocoModel } from '../types';

export interface InstancedGeomRendererProps extends Omit<ThreeElements['group'], 'ref'> {
  /** Only render geoms from this MuJoCo geom group. */
  geomGroup?: number;
  /** Predicate for selecting geoms. */
  filter?: (geom: GeomInfo) => boolean;
  /** Optional material override for every instanced batch. */
  material?: THREE.Material;
  /** Hide or show the instanced batches. */
  visible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

interface GeomBatch {
  key: string;
  geomIds: number[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const GEOM_TYPE_NAMES = ['plane', 'hfield', 'sphere', 'capsule', 'ellipsoid', 'cylinder', 'box', 'mesh'];
const _matrix = new THREE.Matrix4();

function getGeomInfo(model: MujocoModel, geomId: number): GeomInfo {
  const size = model.geom_size.subarray(geomId * 3, geomId * 3 + 3);
  const type = model.geom_type[geomId];
  return {
    id: geomId,
    name: getName(model, model.name_geomadr[geomId]),
    type,
    typeName: GEOM_TYPE_NAMES[type] ?? `type-${type}`,
    size: [size[0], size[1], size[2]],
    bodyId: model.geom_bodyid[geomId],
  };
}

function geomSignature(model: MujocoModel, geomId: number): string {
  const type = model.geom_type[geomId];
  const size = Array.from(model.geom_size.subarray(geomId * 3, geomId * 3 + 3)).join(',');
  const mat = model.geom_matid[geomId];
  const data = model.geom_dataid[geomId];
  const rgba = Array.from(model.geom_rgba.subarray(geomId * 4, geomId * 4 + 4)).join(',');
  return [type, size, mat, data, rgba].join('|');
}

function firstMesh(object: THREE.Object3D): THREE.Mesh | null {
  if (object instanceof THREE.Mesh) return object;
  let mesh: THREE.Mesh | null = null;
  object.traverse((child) => {
    if (!mesh && child instanceof THREE.Mesh) mesh = child;
  });
  return mesh;
}

export function InstancedGeomRenderer({
  geomGroup,
  filter,
  material,
  visible = true,
  castShadow = true,
  receiveShadow = true,
  ...groupProps
}: InstancedGeomRendererProps = {}) {
  const { mjModelRef, mjDataRef, mujocoRef, status } = useMujocoContext();
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  const batches = useMemo<GeomBatch[]>(() => {
    if (status !== 'ready') return [];
    const model = mjModelRef.current;
    if (!model) return [];

    const builder = new GeomBuilder(mujocoRef.current);
    const grouped = new Map<string, number[]>();

    for (let geomId = 0; geomId < model.ngeom; geomId++) {
      if (model.geom_group[geomId] === 3) continue;
      if (geomGroup !== undefined && model.geom_group[geomId] !== geomGroup) continue;
      const info = getGeomInfo(model, geomId);
      if (filter && !filter(info)) continue;
      const key = geomSignature(model, geomId);
      const ids = grouped.get(key);
      if (ids) ids.push(geomId);
      else grouped.set(key, [geomId]);
    }

    const next: GeomBatch[] = [];
    for (const [key, geomIds] of grouped) {
      if (geomIds.length < 2) continue;
      const object = builder.create(model, geomIds[0]);
      if (!object) continue;
      const mesh = firstMesh(object);
      if (!mesh) continue;
      const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      next.push({
        key,
        geomIds,
        geometry: mesh.geometry.clone(),
        material: material ?? sourceMaterial.clone(),
      });
    }

    return next;
  }, [filter, geomGroup, material, mjModelRef, mujocoRef, status]);

  useFrame(() => {
    const data = mjDataRef.current;
    if (!data || !visible) return;

    batches.forEach((batch, batchIndex) => {
      const mesh = meshRefs.current[batchIndex];
      if (!mesh) return;
      batch.geomIds.forEach((geomId, instanceId) => {
        const p = geomId * 3;
        const r = geomId * 9;
        _matrix.set(
          data.geom_xmat[r], data.geom_xmat[r + 1], data.geom_xmat[r + 2], data.geom_xpos[p],
          data.geom_xmat[r + 3], data.geom_xmat[r + 4], data.geom_xmat[r + 5], data.geom_xpos[p + 1],
          data.geom_xmat[r + 6], data.geom_xmat[r + 7], data.geom_xmat[r + 8], data.geom_xpos[p + 2],
          0, 0, 0, 1
        );
        mesh.setMatrixAt(instanceId, _matrix);
      });
      mesh.count = batch.geomIds.length;
      mesh.instanceMatrix.needsUpdate = true;
    });
  });

  if (status !== 'ready' || batches.length === 0) return null;

  return (
    <group {...groupProps} visible={visible}>
      {batches.map((batch, index) => (
        <instancedMesh
          key={batch.key}
          ref={(mesh) => { meshRefs.current[index] = mesh; }}
          args={[batch.geometry, batch.material, batch.geomIds.length]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
