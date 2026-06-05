/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Bodies,
  MujocoData,
  MujocoModel,
  ObservationConfig,
  ObservationLayoutItem,
  ObservationResult,
} from '../types';
import { findBodyByName, findSensorByName, findSiteByName } from './SceneLoader';

function append(
  values: number[],
  layout: ObservationLayoutItem[],
  name: string,
  chunk: ArrayLike<number>
) {
  const start = values.length;
  for (let i = 0; i < chunk.length; i++) values.push(chunk[i] ?? 0);
  layout.push({ name, start, size: chunk.length });
}

function appendScalar(
  values: number[],
  layout: ObservationLayoutItem[],
  name: string,
  value: number
) {
  const start = values.length;
  values.push(value);
  layout.push({ name, start, size: 1 });
}

function namedBodyList(names: Bodies | readonly Bodies[] | undefined): readonly Bodies[] {
  if (!names) return [];
  return typeof names === 'string' ? [names] : names;
}

function normalizedGravity(model: MujocoModel): [number, number, number] {
  const gx = model.opt.gravity[0] ?? 0;
  const gy = model.opt.gravity[1] ?? 0;
  const gz = model.opt.gravity[2] ?? -9.81;
  const length = Math.hypot(gx, gy, gz);
  if (length === 0) return [0, 0, 0];
  return [gx / length, gy / length, gz / length];
}

function rotateWorldVectorToBody(data: MujocoData, bodyId: number, world: readonly [number, number, number]): [number, number, number] {
  const adr = bodyId * 4;
  const w = data.xquat[adr] ?? 1;
  const x = -(data.xquat[adr + 1] ?? 0);
  const y = -(data.xquat[adr + 2] ?? 0);
  const z = -(data.xquat[adr + 3] ?? 0);
  const vx = world[0];
  const vy = world[1];
  const vz = world[2];

  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);

  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
}

/**
 * Build a flat observation vector plus a layout map from live MuJoCo state.
 *
 * Missing named resources are skipped. The returned layout is the source of
 * truth for the vector produced from the current model.
 */
export function buildObservation(
  model: MujocoModel,
  data: MujocoData,
  config: ObservationConfig
): ObservationResult {
  const values: number[] = [];
  const layout: ObservationLayoutItem[] = [];

  if (config.time) appendScalar(values, layout, 'time', data.time);
  if (config.qpos) append(values, layout, 'qpos', data.qpos);
  if (config.qvel) append(values, layout, 'qvel', data.qvel);
  if (config.ctrl) append(values, layout, 'ctrl', data.ctrl);
  if (config.act) append(values, layout, 'act', data.act);
  if (config.sensordata) append(values, layout, 'sensordata', data.sensordata);

  for (const name of config.sensors ?? []) {
    const sensorId = findSensorByName(model, name);
    if (sensorId < 0) continue;
    const start = model.sensor_adr[sensorId] ?? 0;
    const dim = model.sensor_dim[sensorId] ?? 0;
    append(values, layout, `sensor:${name}`, data.sensordata.subarray(start, start + dim));
  }

  for (const name of config.sites ?? []) {
    const siteId = findSiteByName(model, name);
    if (siteId < 0) continue;
    const start = siteId * 3;
    append(values, layout, `site:${name}:xpos`, data.site_xpos.subarray(start, start + 3));
  }

  const gravity = normalizedGravity(model);
  for (const name of namedBodyList(config.projectedGravity)) {
    const bodyId = findBodyByName(model, name);
    if (bodyId < 0) continue;
    append(values, layout, `projectedGravity:${name}`, rotateWorldVectorToBody(data, bodyId, gravity));
  }

  return {
    values: config.output === 'float64' ? new Float64Array(values) : new Float32Array(values),
    layout,
  };
}
