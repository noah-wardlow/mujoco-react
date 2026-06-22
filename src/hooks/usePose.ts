/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ref-based world pose hooks for named MuJoCo bodies, geoms, and sites.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { useAfterPhysicsStep, useMujocoContext } from '../core/MujocoSimProvider';
import { findBodyByName, findGeomByName, findSiteByName } from '../core/SceneLoader';
import type { Bodies, Geoms, Sites } from '../types';

export type PoseResourceKind = 'body' | 'geom' | 'site';

export interface PoseReadout {
  id: RefObject<number>;
  found: RefObject<boolean>;
  position: RefObject<THREE.Vector3>;
  quaternion: RefObject<THREE.Quaternion>;
}

const _matrix = new THREE.Matrix4();

function quaternionFromMatrixArray(
  target: THREE.Quaternion,
  values: ArrayLike<number>,
  offset: number
) {
  _matrix.set(
    values[offset], values[offset + 1], values[offset + 2], 0,
    values[offset + 3], values[offset + 4], values[offset + 5], 0,
    values[offset + 6], values[offset + 7], values[offset + 8], 0,
    0, 0, 0, 1
  );
  target.setFromRotationMatrix(_matrix);
}

function quaternionFromMujocoQuat(
  target: THREE.Quaternion,
  values: ArrayLike<number>,
  offset: number
) {
  target.set(
    values[offset + 1] ?? 0,
    values[offset + 2] ?? 0,
    values[offset + 3] ?? 0,
    values[offset] ?? 1
  );
}

function useNamedPose(kind: PoseResourceKind, name: string): PoseReadout {
  const { mjModelRef, status } = useMujocoContext();
  const idRef = useRef(-1);
  const foundRef = useRef(false);
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());

  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') {
      idRef.current = -1;
      foundRef.current = false;
      return;
    }

    if (kind === 'body') idRef.current = findBodyByName(model, name);
    else if (kind === 'geom') idRef.current = findGeomByName(model, name);
    else idRef.current = findSiteByName(model, name);
    foundRef.current = idRef.current >= 0;
  }, [kind, name, status, mjModelRef]);

  useAfterPhysicsStep(({ data }) => {
    const id = idRef.current;
    if (id < 0) return;

    if (kind === 'body') {
      const p = id * 3;
      positionRef.current.set(data.xpos[p], data.xpos[p + 1], data.xpos[p + 2]);
      if (data.xmat) {
        quaternionFromMatrixArray(quaternionRef.current, data.xmat, id * 9);
      } else {
        quaternionFromMujocoQuat(quaternionRef.current, data.xquat, id * 4);
      }
      return;
    }

    if (kind === 'geom') {
      const p = id * 3;
      positionRef.current.set(data.geom_xpos[p], data.geom_xpos[p + 1], data.geom_xpos[p + 2]);
      quaternionFromMatrixArray(quaternionRef.current, data.geom_xmat, id * 9);
      return;
    }

    const p = id * 3;
    positionRef.current.set(data.site_xpos[p], data.site_xpos[p + 1], data.site_xpos[p + 2]);
    quaternionFromMatrixArray(quaternionRef.current, data.site_xmat, id * 9);
  });

  return {
    id: idRef,
    found: foundRef,
    position: positionRef,
    quaternion: quaternionRef,
  };
}

export function useBodyPose(name: Bodies): PoseReadout {
  return useNamedPose('body', name);
}

export function useGeomPose(name: Geoms): PoseReadout {
  return useNamedPose('geom', name);
}

export function useSitePose(name: Sites): PoseReadout {
  return useNamedPose('site', name);
}
