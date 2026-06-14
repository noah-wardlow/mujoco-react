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
import { useMujocoContext } from '../core/MujocoSimProvider';

export function useSceneLights(intensity = 1.0) {
  const { mjModelRef, status } = useMujocoContext();
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

    const lightActive = getModelArray(model, 'light_active');
    const lightTypeArray = getModelArray(model, 'light_type');
    const lightCastShadow = getModelArray(model, 'light_castshadow');
    const lightIntensity = getModelArray(model, 'light_intensity');
    const lightDiffuse = getModelArray(model, 'light_diffuse');
    const lightPos = getModelArray(model, 'light_pos');
    const lightDir = getModelArray(model, 'light_dir');
    const lightCutoff = getModelArray(model, 'light_cutoff');
    const lightExponent = getModelArray(model, 'light_exponent');
    const lightAttenuation = getModelArray(model, 'light_attenuation');

    if (!lightPos || !lightDir) return;

    for (let i = 0; i < nlight; i++) {
      const active = lightActive ? lightActive[i] : 1;
      if (!active) continue;

      const lightType = lightTypeArray ? lightTypeArray[i] : 0;
      const isDirectional = lightType === 0;
      const castShadow = lightCastShadow ? lightCastShadow[i] !== 0 : false;

      const mjIntensity = lightIntensity ? lightIntensity[i] : 1.0;
      const finalIntensity = intensity * mjIntensity;

      const dr = lightDiffuse ? lightDiffuse[3 * i] : 1;
      const dg = lightDiffuse ? lightDiffuse[3 * i + 1] : 1;
      const db = lightDiffuse ? lightDiffuse[3 * i + 2] : 1;
      const color = new THREE.Color(dr, dg, db);

      const px = lightPos[3 * i];
      const py = lightPos[3 * i + 1];
      const pz = lightPos[3 * i + 2];
      const dx = lightDir[3 * i];
      const dy = lightDir[3 * i + 1];
      const dz = lightDir[3 * i + 2];

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
        const cutoff = lightCutoff ? lightCutoff[i] : 45;
        const exponent = lightExponent ? lightExponent[i] : 10;
        const angle = (cutoff * Math.PI) / 180;
        const light = new THREE.SpotLight(color, finalIntensity, 0, angle, exponent / 128);
        light.position.set(px, py, pz);
        light.target.position.set(px + dx, py + dy, pz + dz);
        light.castShadow = castShadow;

        if (lightAttenuation) {
          const att1 = lightAttenuation[3 * i + 1];
          const att2 = lightAttenuation[3 * i + 2];
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

function getModelArray(model: unknown, key: string): ArrayLike<number> | undefined {
  try {
    const value = (model as Record<string, unknown>)[key];
    return isArrayLikeNumber(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isArrayLikeNumber(value: unknown): value is ArrayLike<number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'length' in value &&
    typeof (value as ArrayLike<number>).length === 'number'
  );
}
