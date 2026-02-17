/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useCameraAnimation — composable camera animation hook.
 */

import { useCallback, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface CameraAnimationAPI {
  getCameraState(): { position: THREE.Vector3; target: THREE.Vector3 };
  moveCameraTo(position: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void>;
}

/**
 * Standalone hook for animated camera transitions.
 *
 * Manages its own `useFrame` callback — drop it into any component inside `<Canvas>`.
 */
export function useCameraAnimation(): CameraAnimationAPI {
  const { camera } = useThree();

  const orbitTargetRef = useRef(new THREE.Vector3(0, 0, 0));

  const cameraAnimRef = useRef({
    active: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startRot: new THREE.Quaternion(),
    endRot: new THREE.Quaternion(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    startTime: 0,
    duration: 0,
    resolve: null as (() => void) | null,
  });

  useFrame((state) => {
    const ca = cameraAnimRef.current;
    if (!ca.active) return;

    const now = performance.now();
    const progress = Math.min((now - ca.startTime) / ca.duration, 1.0);
    const ease =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    camera.position.lerpVectors(ca.startPos, ca.endPos, ease);
    camera.quaternion.slerpQuaternions(ca.startRot, ca.endRot, ease);
    orbitTargetRef.current.lerpVectors(ca.startTarget, ca.endTarget, ease);

    const orbitControls = state.controls as { target?: THREE.Vector3 };
    if (orbitControls?.target) {
      orbitControls.target.copy(orbitTargetRef.current);
    }

    if (progress >= 1.0) {
      ca.active = false;
      camera.position.copy(ca.endPos);
      camera.quaternion.copy(ca.endRot);
      orbitTargetRef.current.copy(ca.endTarget);
      ca.resolve?.();
      ca.resolve = null;
    }
  });

  const getCameraState = useCallback(
    (): { position: THREE.Vector3; target: THREE.Vector3 } => ({
      position: camera.position.clone(),
      target: orbitTargetRef.current.clone(),
    }),
    [camera],
  );

  const moveCameraTo = useCallback(
    (position: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> => {
      return new Promise((resolve) => {
        const ca = cameraAnimRef.current;
        ca.active = true;
        ca.startTime = performance.now();
        ca.duration = durationMs;
        ca.startPos.copy(camera.position);
        ca.startRot.copy(camera.quaternion);
        ca.startTarget.copy(orbitTargetRef.current);
        ca.endPos.copy(position);
        ca.endTarget.copy(target);
        const dummyCam = (camera as THREE.PerspectiveCamera).clone();
        dummyCam.position.copy(position);
        dummyCam.lookAt(target);
        ca.endRot.copy(dummyCam.quaternion);
        ca.resolve = resolve;
        setTimeout(resolve, durationMs + 100);
      });
    },
    [camera],
  );

  return { getCameraState, moveCameraTo };
}
