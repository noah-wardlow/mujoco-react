/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useMujocoContext, useBeforePhysicsStep } from '../core/MujocoSimProvider';
import type { DragInteractionProps } from '../types';

// Preallocated temps to avoid GC pressure
const _force = new Float64Array(3);
const _torque = new Float64Array(3); // always [0,0,0]
const _point = new Float64Array(3);
const _bodyPos = new THREE.Vector3();
const _bodyQuat = new THREE.Quaternion();
const _worldHit = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

/**
 * DragInteraction — Ctrl/Cmd+click-drag to apply spring forces to MuJoCo bodies.
 *
 * Raycasts against scene meshes to identify bodies, then applies a spring
 * force pulling the grabbed point toward the cursor each physics frame.
 * Requires Ctrl (or Cmd on macOS) to avoid conflicting with OrbitControls.
 *
 * - `stiffness` — Spring constant * body mass. Default: 250.
 * - `showArrow` — Show arrow from grab point toward cursor. Default: true.
 *
 * Forces compose with useGravityCompensation — the provider zeros
 * qfrc_applied each frame, then all consumers add to it.
 */
export function DragInteraction({
  stiffness = 250,
  showArrow = true,
  ...groupProps
}: DragInteractionProps & Omit<ThreeElements['group'], 'ref'>) {
  const { mjDataRef, mujocoRef, mjModelRef, status } = useMujocoContext();
  const { gl, camera, scene, controls } = useThree();

  const draggingRef = useRef(false);
  const bodyIdRef = useRef(-1);
  const grabDistanceRef = useRef(0);
  const localHitRef = useRef(new THREE.Vector3());
  const grabWorldRef = useRef(new THREE.Vector3());
  const mouseWorldRef = useRef(new THREE.Vector3());

  // Arrow helper for visual feedback (managed imperatively)
  const arrowRef = useRef<THREE.ArrowHelper | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!showArrow || !groupRef.current) return;
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      0.1,
      0xff4444,
    );
    arrow.visible = false;
    // Make arrow semi-transparent
    (arrow.line.material as THREE.LineBasicMaterial).transparent = true;
    (arrow.line.material as THREE.LineBasicMaterial).opacity = 0.6;
    (arrow.cone.material as THREE.MeshBasicMaterial).transparent = true;
    (arrow.cone.material as THREE.MeshBasicMaterial).opacity = 0.6;
    groupRef.current.add(arrow);
    arrowRef.current = arrow;
    return () => {
      if (groupRef.current) groupRef.current.remove(arrow);
      arrow.dispose();
      arrowRef.current = null;
    };
  }, [showArrow]);

  // Pointer events on the canvas
  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (evt: PointerEvent) => {
      if (evt.button !== 0) return; // left click only
      if (!evt.ctrlKey && !evt.metaKey) return; // require Ctrl/Cmd+click
      const rect = canvas.getBoundingClientRect();
      _mouse.set(
        ((evt.clientX - rect.left) / rect.width) * 2 - 1,
        -((evt.clientY - rect.top) / rect.height) * 2 + 1,
      );
      _raycaster.setFromCamera(_mouse, camera);

      const hits = _raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && obj.userData.bodyID === undefined && obj.parent) {
          obj = obj.parent;
        }
        const bid = obj?.userData.bodyID;
        if (bid !== undefined && bid > 0) {
          bodyIdRef.current = bid;
          draggingRef.current = true;
          grabDistanceRef.current = hit.distance;

          // Store hit point in body-local coords
          const data = mjDataRef.current;
          if (data) {
            const i3 = bid * 3;
            const i4 = bid * 4;
            _bodyPos.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);
            // MuJoCo xquat is [w,x,y,z]; THREE wants (x,y,z,w)
            _bodyQuat.set(
              data.xquat[i4 + 1], data.xquat[i4 + 2],
              data.xquat[i4 + 3], data.xquat[i4]
            );
            // World hit → body-local: inverse(bodyRot) * (hitWorld - bodyPos)
            localHitRef.current.copy(hit.point).sub(_bodyPos);
            localHitRef.current.applyQuaternion(_bodyQuat.clone().invert());
          }

          mouseWorldRef.current.copy(hit.point);
          grabWorldRef.current.copy(hit.point);

          // Disable orbit controls during drag
          if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
          break;
        }
      }
    };

    const onPointerMove = (evt: PointerEvent) => {
      if (!draggingRef.current) return;
      // Safety: if no buttons are pressed, the pointerup was missed
      if (evt.buttons === 0) {
        draggingRef.current = false;
        bodyIdRef.current = -1;
        if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      _mouse.set(
        ((evt.clientX - rect.left) / rect.width) * 2 - 1,
        -((evt.clientY - rect.top) / rect.height) * 2 + 1,
      );
      _raycaster.setFromCamera(_mouse, camera);
      // Project mouse ray to the same grab distance
      mouseWorldRef.current.copy(_raycaster.ray.origin)
        .addScaledVector(_raycaster.ray.direction, grabDistanceRef.current);
    };

    const onPointerUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      bodyIdRef.current = -1;
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    // Listen on window so we catch releases even if pointer leaves the canvas
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [gl, camera, scene, controls, mjDataRef]);

  // Apply spring force each physics frame
  useBeforePhysicsStep((model, data) => {
    if (!draggingRef.current || bodyIdRef.current <= 0) return;

    const bid = bodyIdRef.current;
    const mujoco = mujocoRef.current;

    // Reconstruct grab point world position from body's current pose
    const i3 = bid * 3;
    const i4 = bid * 4;
    _bodyPos.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);
    _bodyQuat.set(
      data.xquat[i4 + 1], data.xquat[i4 + 2],
      data.xquat[i4 + 3], data.xquat[i4]
    );
    _worldHit.copy(localHitRef.current);
    _worldHit.applyQuaternion(_bodyQuat);
    _worldHit.add(_bodyPos);
    grabWorldRef.current.copy(_worldHit);

    // Compute spring force: F = (mouseWorld - grabWorld) * body_mass * stiffness
    const mass = model.body_mass[bid];
    const s = stiffness * mass;
    _force[0] = (mouseWorldRef.current.x - _worldHit.x) * s;
    _force[1] = (mouseWorldRef.current.y - _worldHit.y) * s;
    _force[2] = (mouseWorldRef.current.z - _worldHit.z) * s;

    _point[0] = _worldHit.x;
    _point[1] = _worldHit.y;
    _point[2] = _worldHit.z;

    _torque[0] = 0; _torque[1] = 0; _torque[2] = 0;

    mujoco.mj_applyFT(model, data, _force, _torque, _point, bid, data.qfrc_applied);
  });

  // Update arrow visual
  useFrame(() => {
    const arrow = arrowRef.current;
    if (!arrow) return;

    if (draggingRef.current && bodyIdRef.current > 0) {
      arrow.visible = true;
      const dir = _bodyPos.copy(mouseWorldRef.current).sub(grabWorldRef.current);
      const len = dir.length();
      if (len > 0.001) {
        dir.normalize();
        arrow.position.copy(grabWorldRef.current);
        arrow.setDirection(dir);
        arrow.setLength(len, Math.min(len * 0.2, 0.05), Math.min(len * 0.1, 0.03));
      }
    } else {
      arrow.visible = false;
    }
  });

  if (status !== 'ready') return null;

  return <group {...groupProps} ref={groupRef} />;
}
