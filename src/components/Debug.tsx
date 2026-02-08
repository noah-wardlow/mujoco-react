/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Debug — visualization overlay for MuJoCo scene elements (spec 6.1)
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMujocoSim } from '../core/MujocoSimProvider';
import { getName } from '../core/SceneLoader';
import type { DebugProps } from '../types';

const JOINT_COLORS: Record<number, number> = {
  0: 0xff0000, // free - red
  1: 0x00ff00, // ball - green
  2: 0x0000ff, // slide - blue
  3: 0xffff00, // hinge - yellow
};

/**
 * Declarative debug visualization component.
 * Renders wireframe geoms, site markers, joint axes, contact forces, COM markers, etc.
 */
export function Debug({
  showGeoms = false,
  showSites = false,
  showJoints = false,
  showContacts = false,
  showCOM = false,
  showInertia = false,
  showTendons = false,
}: DebugProps) {
  const { mjModelRef, mjDataRef, status } = useMujocoSim();
  const { scene } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  // Build static debug geometry when model loads
  const debugGeometry = useMemo(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return null;

    const geoms: THREE.Object3D[] = [];
    const sites: THREE.Object3D[] = [];
    const joints: THREE.Object3D[] = [];
    const comMarkers: THREE.Object3D[] = [];

    // Wireframe geoms
    if (showGeoms) {
      for (let i = 0; i < model.ngeom; i++) {
        const type = model.geom_type[i];
        const s = model.geom_size;
        let geometry: THREE.BufferGeometry | null = null;

        switch (type) {
          case 2: // sphere
            geometry = new THREE.SphereGeometry(s[3 * i], 12, 8);
            break;
          case 3: // capsule
            geometry = new THREE.CapsuleGeometry(s[3 * i], s[3 * i + 1] * 2, 6, 8);
            break;
          case 5: // cylinder
            geometry = new THREE.CylinderGeometry(s[3 * i], s[3 * i], s[3 * i + 1] * 2, 12);
            break;
          case 6: // box
            geometry = new THREE.BoxGeometry(s[3 * i] * 2, s[3 * i + 1] * 2, s[3 * i + 2] * 2);
            break;
        }

        if (geometry) {
          const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.3 });
          const mesh = new THREE.Mesh(geometry, mat);
          mesh.userData.geomId = i;
          mesh.userData.bodyId = model.geom_bodyid[i];
          geoms.push(mesh);
        }
      }
    }

    // Site markers
    if (showSites) {
      for (let i = 0; i < model.nsite; i++) {
        const geometry = new THREE.OctahedronGeometry(0.01);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.7 });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.userData.siteId = i;
        sites.push(mesh);
      }
    }

    // Joint axes
    if (showJoints) {
      for (let i = 0; i < model.njnt; i++) {
        const type = model.jnt_type[i];
        const color = JOINT_COLORS[type] ?? 0xffffff;
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1), new THREE.Vector3(),
          0.05, color, 0.01, 0.005
        );
        arrow.userData.jointId = i;
        joints.push(arrow);
      }
    }

    // COM markers
    if (showCOM) {
      for (let i = 1; i < model.nbody; i++) {
        const geometry = new THREE.SphereGeometry(0.005, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.userData.bodyId = i;
        comMarkers.push(mesh);
      }
    }

    return { geoms, sites, joints, comMarkers };
  }, [status, mjModelRef, showGeoms, showSites, showJoints, showCOM]);

  // Add/remove debug objects from scene
  useEffect(() => {
    const group = groupRef.current;
    if (!group || !debugGeometry) return;

    const allObjects = [
      ...debugGeometry.geoms,
      ...debugGeometry.sites,
      ...debugGeometry.joints,
      ...debugGeometry.comMarkers,
    ];
    for (const obj of allObjects) group.add(obj);

    return () => {
      for (const obj of allObjects) {
        group.remove(obj);
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      }
    };
  }, [debugGeometry]);

  // Update positions every frame
  useFrame(() => {
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data || !debugGeometry) return;

    // Update geom wireframes
    for (const mesh of debugGeometry.geoms) {
      const bid = mesh.userData.bodyId;
      const i3 = bid * 3;
      const i4 = bid * 4;
      mesh.position.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);
      mesh.quaternion.set(
        data.xquat[i4 + 1], data.xquat[i4 + 2],
        data.xquat[i4 + 3], data.xquat[i4]
      );
      // Apply local geom offset
      const gid = mesh.userData.geomId;
      const gp = model.geom_pos;
      mesh.position.add(new THREE.Vector3(gp[3 * gid], gp[3 * gid + 1], gp[3 * gid + 2])
        .applyQuaternion(mesh.quaternion));
    }

    // Update site markers
    for (const mesh of debugGeometry.sites) {
      const sid = mesh.userData.siteId;
      mesh.position.set(
        data.site_xpos[3 * sid],
        data.site_xpos[3 * sid + 1],
        data.site_xpos[3 * sid + 2],
      );
    }

    // Update COM markers
    for (const mesh of debugGeometry.comMarkers) {
      const bid = mesh.userData.bodyId;
      const i3 = bid * 3;
      mesh.position.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);
    }
  });

  // Contact force vectors
  const contactGroupRef = useRef<THREE.Group>(null);
  const contactArrowsRef = useRef<THREE.ArrowHelper[]>([]);

  useFrame(() => {
    if (!showContacts) return;
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    const group = contactGroupRef.current;
    if (!model || !data || !group) return;

    // Remove old arrows
    for (const arrow of contactArrowsRef.current) {
      group.remove(arrow);
      arrow.dispose();
    }
    contactArrowsRef.current = [];

    const ncon = data.ncon;
    for (let i = 0; i < Math.min(ncon, 50); i++) {
      try {
        const c = (data.contact as { get(i: number): { pos: Float64Array; frame: Float64Array; dist: number } }).get(i);
        const pos = new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]);
        const normal = new THREE.Vector3(c.frame[0], c.frame[1], c.frame[2]);
        const force = Math.abs(c.dist) * 100;
        const length = Math.min(force * 0.01, 0.1);
        if (length > 0.001) {
          const arrow = new THREE.ArrowHelper(normal, pos, length, 0xff4444, length * 0.3, length * 0.15);
          group.add(arrow);
          contactArrowsRef.current.push(arrow);
        }
      } catch {
        break;
      }
    }
  });

  if (status !== 'ready') return null;

  return (
    <>
      <group ref={groupRef} />
      {showContacts && <group ref={contactGroupRef} />}
    </>
  );
}
