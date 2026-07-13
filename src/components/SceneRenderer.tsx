/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GeomBuilder } from '../rendering/GeomBuilder';
import { CAMERA_FRAME_CAPTURE_PRE_RENDER_USER_DATA_KEY } from '../rendering/cameraFrameCapture';
import { MujocoModel, MujocoRenderOptions } from '../types';
import { getName } from '../core/SceneLoader';
import { useMujocoContext } from '../core/MujocoSimProvider';

/**
 * SceneRenderer — creates and syncs MuJoCo body meshes every frame.
 * Accepts standard R3F group props (position, rotation, scale, visible, etc.).
 */
export interface SceneRendererProps extends Omit<ThreeElements['group'], 'ref'> {
  renderOptions?: MujocoRenderOptions;
}

function getRenderOptionsKey(renderOptions: MujocoRenderOptions | undefined) {
  const smoothing = renderOptions?.meshNormalSmoothing;
  if (!smoothing) return 'default';
  if (smoothing === true) return 'meshNormalSmoothing:true';
  return `meshNormalSmoothing:${smoothing.tolerance ?? 'default'}`;
}

export function SceneRenderer({ renderOptions, ...props }: SceneRendererProps) {
  const {
    mjModelRef,
    mjDataRef,
    mujocoRef,
    onSelectionRef,
    hiddenBodiesRef,
    hiddenBodiesVersion,
    interpolateRef,
    interpolationStateRef,
    status,
  } = useMujocoContext();
  const groupRef = useRef<THREE.Group>(null);
  const bodyRefs = useRef<(THREE.Group | null)[]>([]);
  const prevModelRef = useRef<MujocoModel | null>(null);
  const prevRenderOptionsKeyRef = useRef<string | null>(null);
  const prevHiddenVersionRef = useRef<number | null>(null);
  const renderOptionsKey = getRenderOptionsKey(renderOptions);

  const geomBuilder = useMemo(() => {
    if (status !== 'ready') return null;
    return new GeomBuilder(mujocoRef.current, renderOptions);
  }, [status, mujocoRef, renderOptionsKey]);

  // Build body groups when model loads
  useEffect(() => {
    if (status !== 'ready' || !geomBuilder) return;
    const model = mjModelRef.current;
    const group = groupRef.current;
    if (!model || !group) return;

    // Skip if neither the model, render options, nor the hidden-body set changed
    if (
      prevModelRef.current === model &&
      prevRenderOptionsKeyRef.current === renderOptionsKey &&
      prevHiddenVersionRef.current === hiddenBodiesVersion
    ) {
      return;
    }
    prevModelRef.current = model;
    prevRenderOptionsKeyRef.current = renderOptionsKey;
    prevHiddenVersionRef.current = hiddenBodiesVersion;

    // Clear previous bodies
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    // Create body groups with geometry
    const refs: (THREE.Group | null)[] = [];
    for (let i = 0; i < model.nbody; i++) {
      const bodyGroup = new THREE.Group();
      bodyGroup.userData.bodyID = i;
      const bodyName = getName(model, model.name_bodyadr[i]);

      if (!hiddenBodiesRef.current.has(bodyName)) {
        for (let g = 0; g < model.ngeom; g++) {
          if (model.geom_bodyid[g] === i) {
            const mesh = geomBuilder.create(model, g);
            if (mesh) bodyGroup.add(mesh);
          }
        }
      }

      group.add(bodyGroup);
      refs.push(bodyGroup);
    }
    bodyRefs.current = refs;
  }, [status, geomBuilder, mjModelRef, renderOptionsKey, hiddenBodiesRef, hiddenBodiesVersion]);

  const syncBodiesToData = useCallback(() => {
    const data = mjDataRef.current;
    if (!data) return;
    const bodies = bodyRefs.current;
    const interpolation = interpolationStateRef.current;
    const useInterpolation = interpolateRef.current && interpolation.valid;

    for (let i = 0; i < bodies.length; i++) {
      const ref = bodies[i];
      if (!ref) continue;
      if (useInterpolation) {
        const alpha = interpolation.alpha;
        const i3 = i * 3;
        ref.position.set(
          THREE.MathUtils.lerp(interpolation.previousXpos[i3], interpolation.currentXpos[i3], alpha),
          THREE.MathUtils.lerp(interpolation.previousXpos[i3 + 1], interpolation.currentXpos[i3 + 1], alpha),
          THREE.MathUtils.lerp(interpolation.previousXpos[i3 + 2], interpolation.currentXpos[i3 + 2], alpha)
        );
        const i4 = i * 4;
        _previousQuat.set(
          interpolation.previousXquat[i4 + 1],
          interpolation.previousXquat[i4 + 2],
          interpolation.previousXquat[i4 + 3],
          interpolation.previousXquat[i4]
        );
        _currentQuat.set(
          interpolation.currentXquat[i4 + 1],
          interpolation.currentXquat[i4 + 2],
          interpolation.currentXquat[i4 + 3],
          interpolation.currentXquat[i4]
        );
        ref.quaternion.copy(_previousQuat).slerp(_currentQuat, alpha);
      } else {
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
    }
  }, [interpolateRef, interpolationStateRef, mjDataRef]);

  // Sync body positions from mjData every frame
  useFrame(syncBodiesToData);

  return (
    <group
      {...props}
      ref={groupRef}
      userData={{
        ...props.userData,
        [CAMERA_FRAME_CAPTURE_PRE_RENDER_USER_DATA_KEY]: syncBodiesToData,
      }}
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
            onSelectionRef.current({ bodyId: bodyID, name });
          }
        }
      }}
    />
  );
}

const _previousQuat = new THREE.Quaternion();
const _currentQuat = new THREE.Quaternion();
