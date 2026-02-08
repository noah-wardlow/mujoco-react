/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PivotControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useMujocoSim } from '../core/MujocoSimProvider';
import { findSiteByName } from '../core/SceneLoader';
import type { IkGizmoProps } from '../types';

// Preallocated temps to avoid GC pressure in useFrame
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * IkGizmo — drei PivotControls that tracks a MuJoCo site.
 *
 * Props:
 * - `siteName` — MuJoCo site to track. Defaults to `SceneConfig.tcpSiteName`.
 * - `scale` — Gizmo handle scale. Default: 0.18.
 * - `onDrag` — Custom drag callback `(pos, quat) => void`.
 *   When omitted, dragging enables IK and writes to the provider's IK target.
 *   When provided, the consumer handles what happens during drag.
 *
 * Multiple gizmos can be rendered — each tracks its own site.
 * Zero gizmos is fine — programmatic IK control works via the provider API.
 *
 * Uses a tiny invisible mesh as child instead of axesHelper — PivotControls
 * computes an anchor offset from children's bounding box, and axesHelper's
 * (0→0.15) bounds would shift the handles away from the TCP origin.
 */
export function IkGizmo({ siteName, scale = 0.18, onDrag }: IkGizmoProps) {
  const {
    ikTargetRef, mjModelRef, mjDataRef, siteIdRef,
    api, ikEnabledRef, status,
  } = useMujocoSim();

  const wrapperRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Group>(null);
  const draggingRef = useRef(false);
  const localSiteIdRef = useRef(-1);
  const { controls } = useThree();

  // Resolve the site ID from siteName (or fall back to provider's tcpSiteName)
  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') {
      localSiteIdRef.current = -1;
      return;
    }
    if (siteName) {
      localSiteIdRef.current = findSiteByName(model, siteName);
    } else {
      // Default: use the provider's siteIdRef (from SceneConfig.tcpSiteName)
      localSiteIdRef.current = siteIdRef.current;
    }
  }, [siteName, status, mjModelRef, siteIdRef]);

  // Every frame: sync the visual wrapper to the tracked site (when not dragging)
  useFrame(() => {
    const data = mjDataRef.current;
    const sid = localSiteIdRef.current;
    if (!data || sid < 0 || !wrapperRef.current) return;

    if (!draggingRef.current) {
      const p = data.site_xpos;
      const m = data.site_xmat;
      const i3 = sid * 3;
      const i9 = sid * 9;

      // Position wrapper at the site
      wrapperRef.current.position.set(p[i3], p[i3 + 1], p[i3 + 2]);
      // MuJoCo site_xmat is row-major 3x3; THREE.Matrix4.set() is row-major
      _mat4.set(
        m[i9],     m[i9 + 1], m[i9 + 2], 0,
        m[i9 + 3], m[i9 + 4], m[i9 + 5], 0,
        m[i9 + 6], m[i9 + 7], m[i9 + 8], 0,
        0,          0,          0,          1,
      );
      wrapperRef.current.quaternion.setFromRotationMatrix(_mat4);

      // Reset any accumulated drag delta so handles stay at wrapper origin
      if (pivotRef.current) {
        pivotRef.current.matrix.identity();
      }
    }
  });

  // Don't render until the model is loaded (avoids gizmo at origin)
  if (status !== 'ready') return null;

  return (
    <group ref={wrapperRef}>
      <PivotControls
        ref={pivotRef}
        autoTransform
        scale={scale}
        fixed={false}
        depthTest={false}
        disableScaling
        onDragStart={() => {
          draggingRef.current = true;
          if (!onDrag) {
            // Default: enable IK so the robot follows
            if (!ikEnabledRef.current) api.setIkEnabled(true);
          }
          if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
        }}
        onDragEnd={() => {
          draggingRef.current = false;
          // Reset PivotControls so it doesn't accumulate across drags
          if (pivotRef.current) {
            pivotRef.current.matrix.identity();
            pivotRef.current.matrixWorldNeedsUpdate = true;
          }
          if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
        }}
        onDrag={(_l, _dl, world) => {
          world.decompose(_pos, _quat, _scale);
          if (onDrag) {
            // Custom: consumer handles the drag
            onDrag(_pos.clone(), _quat.clone());
          } else {
            // Default: write to provider's IK target
            const target = ikTargetRef.current;
            if (target) {
              target.position.copy(_pos);
              target.quaternion.copy(_quat);
            }
          }
        }}
      >
        {/* Invisible zero-size child: gives PivotControls a valid child
            without creating bounding-box anchor offset */}
        <mesh visible={false}>
          <sphereGeometry args={[0.001]} />
        </mesh>
      </PivotControls>
    </group>
  );
}
