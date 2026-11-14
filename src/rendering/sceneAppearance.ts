import * as THREE from 'three';
import { MujocoAppearance, type MujocoData, type MujocoModel, type MujocoModule } from '../types';
import { GeomBuilder } from './GeomBuilder';

type Restore = () => void;
type Parts = Pick<THREE.Mesh, 'geometry' | 'material'>;
const owners = new WeakMap<THREE.Object3D, { apply: (profile: MujocoAppearance) => Restore }>();

function controllers(scene: THREE.Object3D) {
  const found: { apply: (profile: MujocoAppearance) => Restore }[] = [];
  scene.traverse(object => { const owner = owners.get(object); if (owner) found.push(owner); });
  return found;
}

export function resolveCameraAppearance(scene: THREE.Object3D, requested?: MujocoAppearance): MujocoAppearance {
  if (requested !== undefined && requested !== MujocoAppearance.Standard && requested !== MujocoAppearance.Classic)
    throw new Error('Camera appearance must be MujocoAppearance.Standard or MujocoAppearance.Classic');
  const managed = controllers(scene).length > 0;
  if (!managed && requested === MujocoAppearance.Classic)
    throw new Error('Classic camera appearance requires a managed MuJoCo scene');
  return requested ?? (managed ? MujocoAppearance.Classic : MujocoAppearance.Standard);
}

/** Scope only synchronous rendering. Never retain alternate meshes across an await. */
export function withCameraAppearance<T>(scene: THREE.Object3D, profile: MujocoAppearance, render: () => T): T {
  const restores: Restore[] = [];
  try {
    for (const owner of controllers(scene)) restores.push(owner.apply(profile));
    return render();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

/** One set of body transforms, with lazily cached geometry/material alternatives.
 * Visibility, geom tags, selection and physics ownership remain on the original meshes. */
export function registerSceneAppearance(root: THREE.Object3D, engine: MujocoModule,
  model: MujocoModel, data: MujocoData, viewer: MujocoAppearance) {
  const entries: { mesh: THREE.Mesh; viewer: Parts; alternate?: THREE.Mesh }[] = [];
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && typeof mesh.userData.geomID === 'number')
      entries.push({ mesh, viewer: { geometry: mesh.geometry, material: mesh.material } });
  });
  const other = viewer === MujocoAppearance.Standard ? MujocoAppearance.Classic : MujocoAppearance.Standard;
  const builder = new GeomBuilder(engine, { appearance: other });
  let active = viewer;
  let disposed = false;
  let buildError: unknown;
  owners.set(root, { apply(profile) {
    if (disposed) throw new Error('MuJoCo appearance resources are disposed');
    if (profile === active) return () => {};
    if (buildError) throw buildError;
    // Build all alternatives before mutating the live scene; a failed build leaves it intact.
    if (profile !== viewer) try {
      for (const entry of entries) entry.alternate ??= builder.create(model, entry.mesh.userData.geomID, data) as THREE.Mesh;
    } catch (error) { buildError = error; throw error; }
    const previous = active;
    const saved = entries.map(entry => ({ geometry: entry.mesh.geometry, material: entry.mesh.material }));
    for (const [i, entry] of entries.entries()) {
      if (active === viewer) entry.viewer = saved[i];
      const parts = profile === viewer ? entry.viewer : entry.alternate!;
      entry.mesh.geometry = parts.geometry;
      entry.mesh.material = parts.material;
    }
    active = profile;
    return () => {
      for (const [i, entry] of entries.entries()) Object.assign(entry.mesh, saved[i]);
      active = previous;
    };
  } });
  return () => {
    if (disposed) return;
    disposed = true;
    owners.delete(root);
    for (const entry of entries) if (entry.alternate) {
      entry.alternate.geometry.dispose();
      for (const material of Array.isArray(entry.alternate.material) ? entry.alternate.material : [entry.alternate.material]) material.dispose();
    }
    builder.dispose();
  };
}
