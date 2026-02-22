/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useBodyState — per-body position/velocity tracking (spec 2.2)
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useMujocoContext, useAfterPhysicsStep } from '../core/MujocoSimProvider';
import { findBodyByName } from '../core/SceneLoader';
import type { BodyStateResult } from '../types';

/**
 * Track a MuJoCo body's world position, quaternion, and velocities.
 * All values are ref-based — updated every physics frame without re-renders.
 */
export function useBodyState(name: string): BodyStateResult {
  const { mjModelRef, status } = useMujocoContext();
  const bodyIdRef = useRef(-1);
  const position = useRef(new THREE.Vector3());
  const quaternion = useRef(new THREE.Quaternion());
  const linearVelocity = useRef(new THREE.Vector3());
  const angularVelocity = useRef(new THREE.Vector3());

  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;
    bodyIdRef.current = findBodyByName(model, name);
  }, [name, status, mjModelRef]);

  useAfterPhysicsStep((_model, data) => {
    const bid = bodyIdRef.current;
    if (bid < 0) return;

    // Position from xpos (3 per body)
    const i3 = bid * 3;
    position.current.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);

    // Quaternion from xquat (4 per body, MuJoCo order: w,x,y,z)
    const i4 = bid * 4;
    quaternion.current.set(
      data.xquat[i4 + 1], data.xquat[i4 + 2],
      data.xquat[i4 + 3], data.xquat[i4]
    );

    // Velocity from cvel (6 per body: [angular(3), linear(3)])
    if (data.cvel) {
      const i6 = bid * 6;
      angularVelocity.current.set(data.cvel[i6], data.cvel[i6 + 1], data.cvel[i6 + 2]);
      linearVelocity.current.set(data.cvel[i6 + 3], data.cvel[i6 + 4], data.cvel[i6 + 5]);
    }
  });

  return { position, quaternion, linearVelocity, angularVelocity };
}
