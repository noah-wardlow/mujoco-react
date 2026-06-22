/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Named policy observation builders with layout and units metadata.
 */

import type {
  Bodies,
  Geoms,
  MujocoData,
  MujocoModel,
  ObservationOutput,
  Sites,
} from './types';
import { findBodyByName, findGeomByName, findSiteByName } from './core/SceneLoader';

export type NamedObservationMissing = 'skip' | 'zeros' | 'throw';

export interface NamedObservationInput {
  model: MujocoModel;
  data: MujocoData;
}

export interface NamedObservationField {
  name: string;
  size: number;
  units?: string;
  read: (input: NamedObservationInput) => ArrayLike<number> | number | null | undefined;
}

export interface NamedObservationLayoutItem {
  name: string;
  start: number;
  size: number;
  units?: string;
}

export interface NamedObservationOptions {
  fields: readonly NamedObservationField[];
  output?: ObservationOutput;
  missing?: NamedObservationMissing;
}

export interface NamedObservationResult {
  values: Float32Array | Float64Array;
  layout: NamedObservationLayoutItem[];
}

function pushValues(target: number[], value: ArrayLike<number> | number, size: number) {
  if (typeof value === 'number') {
    target.push(value);
    for (let index = 1; index < size; index += 1) target.push(0);
    return;
  }

  for (let index = 0; index < size; index += 1) {
    target.push(Number(value[index] ?? 0));
  }
}

export function readNamedObservation(
  model: MujocoModel,
  data: MujocoData,
  options: NamedObservationOptions
): NamedObservationResult {
  const values: number[] = [];
  const layout: NamedObservationLayoutItem[] = [];
  const missing = options.missing ?? 'skip';

  for (const field of options.fields) {
    const start = values.length;
    const value = field.read({ model, data });
    if (value === null || value === undefined) {
      if (missing === 'skip') continue;
      if (missing === 'throw') {
        throw new Error(`Unable to read named observation field "${field.name}".`);
      }
      for (let index = 0; index < field.size; index += 1) values.push(0);
    } else {
      pushValues(values, value, field.size);
    }
    layout.push({
      name: field.name,
      start,
      size: field.size,
      units: field.units,
    });
  }

  return {
    values: options.output === 'float64'
      ? new Float64Array(values)
      : new Float32Array(values),
    layout,
  };
}

export function createNamedObservationBuilder(options: NamedObservationOptions) {
  return (model: MujocoModel, data: MujocoData) => (
    readNamedObservation(model, data, options)
  );
}

export function qposField(name: string, index: number, units = 'qpos'): NamedObservationField {
  return {
    name,
    size: 1,
    units,
    read: ({ data }) => data.qpos[index],
  };
}

export function qvelField(name: string, index: number, units = 'qvel'): NamedObservationField {
  return {
    name,
    size: 1,
    units,
    read: ({ data }) => data.qvel[index],
  };
}

export function ctrlField(name: string, index: number, units = 'ctrl'): NamedObservationField {
  return {
    name,
    size: 1,
    units,
    read: ({ data }) => data.ctrl[index],
  };
}

export function bodyPositionField(name: Bodies, units = 'world_position'): NamedObservationField {
  return {
    name: `body:${name}:xpos`,
    size: 3,
    units,
    read: ({ model, data }) => {
      const bodyId = findBodyByName(model, name);
      if (bodyId < 0) return null;
      const offset = bodyId * 3;
      return data.xpos.subarray(offset, offset + 3);
    },
  };
}

export function geomPositionField(name: Geoms, units = 'world_position'): NamedObservationField {
  return {
    name: `geom:${name}:xpos`,
    size: 3,
    units,
    read: ({ model, data }) => {
      const geomId = findGeomByName(model, name);
      if (geomId < 0) return null;
      const offset = geomId * 3;
      return data.geom_xpos.subarray(offset, offset + 3);
    },
  };
}

export function sitePositionField(name: Sites, units = 'world_position'): NamedObservationField {
  return {
    name: `site:${name}:xpos`,
    size: 3,
    units,
    read: ({ model, data }) => {
      const siteId = findSiteByName(model, name);
      if (siteId < 0) return null;
      const offset = siteId * 3;
      return data.site_xpos.subarray(offset, offset + 3);
    },
  };
}
