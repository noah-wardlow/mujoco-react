/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { findSiteByName } from '../core/SceneLoader';
import type { Sites, SitePositionResult } from '../types';

// Preallocated temp for rotation matrix extraction
const _mat4 = new THREE.Matrix4();

/**
 * Returns reactive refs for a MuJoCo site's world position and orientation.
 * Refs are updated every frame without triggering React re-renders.
 */
export function useSitePosition(siteName: Sites): SitePositionResult {
  const { mjModelRef, mjDataRef, status } = useMujocoContext();
  const siteIdRef = useRef(-1);
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());

  // Resolve site ID when model is ready
  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') {
      siteIdRef.current = -1;
      return;
    }
    siteIdRef.current = findSiteByName(model, siteName);
  }, [siteName, status, mjModelRef]);

  // Update refs every frame
  useFrame(() => {
    const data = mjDataRef.current;
    const sid = siteIdRef.current;
    if (!data || sid < 0) return;

    const i3 = sid * 3;
    const i9 = sid * 9;

    positionRef.current.set(
      data.site_xpos[i3],
      data.site_xpos[i3 + 1],
      data.site_xpos[i3 + 2]
    );

    const m = data.site_xmat;
    _mat4.set(
      m[i9],     m[i9 + 1], m[i9 + 2], 0,
      m[i9 + 3], m[i9 + 4], m[i9 + 5], 0,
      m[i9 + 6], m[i9 + 7], m[i9 + 8], 0,
      0,          0,          0,          1,
    );
    quaternionRef.current.setFromRotationMatrix(_mat4);
  });

  return { position: positionRef, quaternion: quaternionRef };
}
