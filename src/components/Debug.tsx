/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Debug — visualization overlay for MuJoCo scene elements (spec 6.1)
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { useMujoco } from '../core/MujocoSimProvider';
import { getName } from '../core/SceneLoader';
import { getContact } from '../types';
import type { DebugProps } from '../types';

const JOINT_COLORS: Record<number, number> = {
  0: 0xff0000, // free - red
  1: 0x00ff00, // ball - green
  2: 0x0000ff, // slide - blue
  3: 0xffff00, // hinge - yellow
};

// Preallocated temps to avoid per-frame GC pressure
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _contactPos = new THREE.Vector3();
const _contactNormal = new THREE.Vector3();
const MAX_CONTACT_ARROWS = 50;

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
  ...groupProps
}: DebugProps & Omit<ThreeElements['group'], 'ref'>) {
  const { mjModelRef, mjDataRef, status } = useMujoco();
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

    // Site markers — scale based on site_size if available, else use geom_size of parent body
    if (showSites) {
      const siteSize = (model as Record<string, unknown>).site_size as Float64Array | undefined;
      for (let i = 0; i < model.nsite; i++) {
        // Determine marker radius: use site_size[3*i] if available, else estimate from parent body's geoms
        let radius = 0.008;
        if (siteSize) {
          radius = Math.max(siteSize[3 * i] * 0.5, 0.004);
        } else {
          // Estimate from parent body's geom sizes
          const bodyId = model.site_bodyid[i];
          let maxGeomSize = 0;
          for (let g = 0; g < model.ngeom; g++) {
            if (model.geom_bodyid[g] === bodyId) {
              maxGeomSize = Math.max(maxGeomSize, model.geom_size[3 * g]);
            }
          }
          if (maxGeomSize > 0) radius = maxGeomSize * 0.15;
        }

        const geometry = new THREE.OctahedronGeometry(radius);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.renderOrder = 999;
        mesh.frustumCulled = false;
        mesh.userData.siteId = i;

        // Label
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ff00ff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(getName(model, model.name_siteadr[i]), 128, 42);
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        const labelScale = radius * 15;
        sprite.scale.set(labelScale, labelScale * 0.25, 1);
        sprite.position.y = radius * 2;
        sprite.renderOrder = 999;
        mesh.add(sprite);

        sites.push(mesh);
      }
    }

    // Joint axes — scale arrow length based on parent body's geom sizes
    if (showJoints) {
      // Safely check for jnt_pos/jnt_axis on the WASM model
      const jntPos = (model as Record<string, unknown>).jnt_pos as Float64Array | undefined;
      const jntAxis = (model as Record<string, unknown>).jnt_axis as Float64Array | undefined;

      for (let i = 0; i < model.njnt; i++) {
        const type = model.jnt_type[i];
        const color = JOINT_COLORS[type] ?? 0xffffff;

        // Scale based on parent body geom size
        const bodyId = model.jnt_bodyid[i];
        let maxGeomSize = 0;
        for (let g = 0; g < model.ngeom; g++) {
          if (model.geom_bodyid[g] === bodyId) {
            maxGeomSize = Math.max(maxGeomSize, model.geom_size[3 * g]);
          }
        }
        const arrowLen = Math.max(maxGeomSize * 0.8, 0.05);

        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1), new THREE.Vector3(),
          arrowLen, color, arrowLen * 0.25, arrowLen * 0.12
        );
        // Render on top so arrows show through geometry
        arrow.renderOrder = 999;
        arrow.frustumCulled = false;
        arrow.line.material = new THREE.LineBasicMaterial({ color, depthTest: false });
        (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
        arrow.line.renderOrder = 999;
        arrow.line.frustumCulled = false;
        arrow.cone.renderOrder = 999;
        arrow.cone.frustumCulled = false;
        arrow.userData.jointId = i;
        arrow.userData.bodyId = bodyId;
        arrow.userData.hasJntPos = !!jntPos;
        arrow.userData.hasJntAxis = !!jntAxis;
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

    // Safely grab optional arrays once
    const jntPos = (model as Record<string, unknown>).jnt_pos as Float64Array | undefined;
    const jntAxis = (model as Record<string, unknown>).jnt_axis as Float64Array | undefined;

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
      _v3a.set(gp[3 * gid], gp[3 * gid + 1], gp[3 * gid + 2])
        .applyQuaternion(mesh.quaternion);
      mesh.position.add(_v3a);
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

    // Update joint axes
    for (const obj of debugGeometry.joints) {
      const arrow = obj as THREE.ArrowHelper;
      const jid = arrow.userData.jointId;
      const bid = arrow.userData.bodyId;
      const i3 = bid * 3;
      const i4 = bid * 4;

      _quat.set(
        data.xquat[i4 + 1], data.xquat[i4 + 2],
        data.xquat[i4 + 3], data.xquat[i4]
      );

      // Position: body origin + local joint anchor (if available)
      arrow.position.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);
      if (jntPos) {
        _v3a.set(jntPos[3 * jid], jntPos[3 * jid + 1], jntPos[3 * jid + 2])
          .applyQuaternion(_quat);
        arrow.position.add(_v3a);
      }

      // Orient along joint axis in world frame (if available)
      if (jntAxis) {
        _v3a.set(jntAxis[3 * jid], jntAxis[3 * jid + 1], jntAxis[3 * jid + 2])
          .applyQuaternion(_quat).normalize();
        arrow.setDirection(_v3a);
      }
    }

    // Update COM markers
    for (const mesh of debugGeometry.comMarkers) {
      const bid = mesh.userData.bodyId;
      const i3 = bid * 3;
      mesh.position.set(data.xpos[i3], data.xpos[i3 + 1], data.xpos[i3 + 2]);
    }
  });

  // Contact force vectors — pre-created pool to avoid per-frame allocation
  const contactGroupRef = useRef<THREE.Group>(null);
  const contactPoolRef = useRef<THREE.ArrowHelper[]>([]);
  const contactPoolInitRef = useRef(false);

  // Initialize arrow pool once
  useEffect(() => {
    const group = contactGroupRef.current;
    if (!group || contactPoolInitRef.current) return;
    contactPoolInitRef.current = true;

    const pool: THREE.ArrowHelper[] = [];
    for (let i = 0; i < MAX_CONTACT_ARROWS; i++) {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.1, 0xff4444, 0.03, 0.015
      );
      arrow.visible = false;
      group.add(arrow);
      pool.push(arrow);
    }
    contactPoolRef.current = pool;

    return () => {
      for (const arrow of pool) {
        group.remove(arrow);
        arrow.dispose();
      }
      contactPoolRef.current = [];
      contactPoolInitRef.current = false;
    };
  }, [showContacts]);

  useFrame(() => {
    if (!showContacts) return;
    const data = mjDataRef.current;
    const pool = contactPoolRef.current;
    if (!data || pool.length === 0) return;

    const ncon = data.ncon;
    let arrowIdx = 0;

    for (let i = 0; i < Math.min(ncon, MAX_CONTACT_ARROWS); i++) {
      const c = getContact(data, i);
      if (!c) break;
      _contactPos.set(c.pos[0], c.pos[1], c.pos[2]);
      _contactNormal.set(c.frame[0], c.frame[1], c.frame[2]);
      const force = Math.abs(c.dist) * 100;
      const length = Math.min(force * 0.01, 0.1);
      if (length > 0.001 && arrowIdx < pool.length) {
        const arrow = pool[arrowIdx];
        arrow.position.copy(_contactPos);
        arrow.setDirection(_contactNormal);
        arrow.setLength(length, length * 0.3, length * 0.15);
        arrow.visible = true;
        arrowIdx++;
      }
    }

    // Hide unused arrows
    for (let i = arrowIdx; i < pool.length; i++) {
      pool[i].visible = false;
    }
  });

  if (status !== 'ready') return null;

  return (
    <group {...groupProps}>
      <group ref={groupRef} />
      {showContacts && <group ref={contactGroupRef} />}
    </group>
  );
}
