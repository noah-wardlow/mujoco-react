/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useSceneLights — hook form of SceneLights (spec 6.3)
 *
 * Auto-creates Three.js lights from MJCF <light> elements.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useMujocoSim } from '../core/MujocoSimProvider';

export function useSceneLights(intensity = 1.0) {
  const { mjModelRef, status } = useMujocoSim();
  const { scene } = useThree();
  const lightsRef = useRef<THREE.Light[]>([]);
  const targetsRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;

    // Clean up previous lights
    for (const light of lightsRef.current) {
      scene.remove(light);
      light.dispose();
    }
    for (const t of targetsRef.current) scene.remove(t);
    lightsRef.current = [];
    targetsRef.current = [];

    const nlight = model.nlight ?? 0;
    if (nlight === 0) return;

    for (let i = 0; i < nlight; i++) {
      const active = model.light_active ? model.light_active[i] : 1;
      if (!active) continue;

      const lightType = model.light_type ? model.light_type[i] : 0;
      const isDirectional = lightType === 0;
      const castShadow = model.light_castshadow ? model.light_castshadow[i] !== 0 : false;

      const mjIntensity = model.light_intensity ? model.light_intensity[i] : 1.0;
      const finalIntensity = intensity * mjIntensity;

      const dr = model.light_diffuse ? model.light_diffuse[3 * i] : 1;
      const dg = model.light_diffuse ? model.light_diffuse[3 * i + 1] : 1;
      const db = model.light_diffuse ? model.light_diffuse[3 * i + 2] : 1;
      const color = new THREE.Color(dr, dg, db);

      const px = model.light_pos[3 * i];
      const py = model.light_pos[3 * i + 1];
      const pz = model.light_pos[3 * i + 2];
      const dx = model.light_dir[3 * i];
      const dy = model.light_dir[3 * i + 1];
      const dz = model.light_dir[3 * i + 2];

      if (isDirectional) {
        const light = new THREE.DirectionalLight(color, finalIntensity);
        light.position.set(px, py, pz);
        light.target.position.set(px + dx, py + dy, pz + dz);
        light.castShadow = castShadow;
        if (castShadow) {
          light.shadow.mapSize.width = 1024;
          light.shadow.mapSize.height = 1024;
          light.shadow.camera.near = 0.1;
          light.shadow.camera.far = 50;
          const d = 5;
          light.shadow.camera.left = -d;
          light.shadow.camera.right = d;
          light.shadow.camera.top = d;
          light.shadow.camera.bottom = -d;
        }
        scene.add(light);
        scene.add(light.target);
        lightsRef.current.push(light);
        targetsRef.current.push(light.target);
      } else {
        const cutoff = model.light_cutoff ? model.light_cutoff[i] : 45;
        const exponent = model.light_exponent ? model.light_exponent[i] : 10;
        const angle = (cutoff * Math.PI) / 180;
        const light = new THREE.SpotLight(color, finalIntensity, 0, angle, exponent / 128);
        light.position.set(px, py, pz);
        light.target.position.set(px + dx, py + dy, pz + dz);
        light.castShadow = castShadow;

        if (model.light_attenuation) {
          const att1 = model.light_attenuation[3 * i + 1];
          const att2 = model.light_attenuation[3 * i + 2];
          light.decay = att2 > 0 ? 2 : (att1 > 0 ? 1 : 0);
          light.distance = att1 > 0 ? 1 / att1 : 0;
        }

        if (castShadow) {
          light.shadow.mapSize.width = 512;
          light.shadow.mapSize.height = 512;
        }
        scene.add(light);
        scene.add(light.target);
        lightsRef.current.push(light);
        targetsRef.current.push(light.target);
      }
    }

    return () => {
      for (const light of lightsRef.current) {
        scene.remove(light);
        light.dispose();
      }
      for (const t of targetsRef.current) scene.remove(t);
      lightsRef.current = [];
      targetsRef.current = [];
    };
  }, [status, mjModelRef, scene, intensity]);
}
