/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { findBodyByName } from '../core/SceneLoader';
import type { BodyProps, SceneObject } from '../types';

/**
 * Declarative physics body component. Registers a body definition in the
 * provider-level registry so it gets injected into the MJCF XML at load time.
 *
 * Bodies present at initial mount cause zero extra reloads (useLayoutEffect
 * runs before the provider's loadScene useEffect). Bodies added/removed after
 * the initial load trigger a debounced scene reload.
 */
export function Body({
  name,
  type,
  size,
  position = [0, 0, 0],
  rgba = [0.5, 0.5, 0.5, 1],
  mass,
  freejoint,
  friction,
  solref,
  solimp,
  condim,
  children,
}: BodyProps) {
  const { bodyRegistryRef, hiddenBodiesRef, requestBodyReload, mjDataRef, mjModelRef, status } =
    useMujocoContext();
  const bodyIdRef = useRef(-1);
  const groupRef = useRef<THREE.Group>(null);
  const initialLoadRef = useRef(true);
  const hasChildren = children != null;

  // Register in body registry BEFORE the provider's loadScene useEffect fires.
  useLayoutEffect(() => {
    const definition: SceneObject = {
      name,
      type,
      size,
      position,
      rgba,
      mass,
      freejoint,
      friction,
      solref,
      solimp,
      condim,
    };
    bodyRegistryRef.current.set(name, { definition, hasCustomChildren: hasChildren });
    if (hasChildren) {
      hiddenBodiesRef.current.add(name);
    }

    return () => {
      bodyRegistryRef.current.delete(name);
      hiddenBodiesRef.current.delete(name);
      if (!initialLoadRef.current) {
        requestBodyReload();
      }
    };
  }, [name, type, size, position, rgba, mass, freejoint, friction, solref, solimp, condim, hasChildren, bodyRegistryRef, hiddenBodiesRef, requestBodyReload]);

  // Resolve body ID once the scene is ready
  useEffect(() => {
    if (status !== 'ready') return;
    const model = mjModelRef.current;
    if (!model) return;
    bodyIdRef.current = findBodyByName(model, name);
    initialLoadRef.current = false;
  }, [status, name, mjModelRef]);

  // Sync group transform to body pose each frame (only when children are provided)
  useFrame(() => {
    if (!hasChildren) return;
    const data = mjDataRef.current;
    const id = bodyIdRef.current;
    const group = groupRef.current;
    if (!data || id < 0 || !group) return;

    const i3 = id * 3;
    const i4 = id * 4;
    group.position.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);
    group.quaternion.set(
      data.xquat[i4 + 1],
      data.xquat[i4 + 2],
      data.xquat[i4 + 3],
      data.xquat[i4],
    );
  });

  if (!hasChildren) return null;

  return <group ref={groupRef}>{children}</group>;
}
