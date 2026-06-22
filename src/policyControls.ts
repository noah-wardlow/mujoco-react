/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers for applying policy action vectors to MuJoCo controls.
 */

import type { MujocoData, MujocoModel, PolicyVector } from './types';

export interface ApplyPolicyActionToControlsOptions {
  /**
   * First actuator/control index to write. Defaults to 0.
   */
  actuatorOffset?: number;
  /**
   * Maximum number of controls to write. Defaults to the action length.
   */
  actionSize?: number;
  /**
   * Clamp each action value to `model.actuator_ctrlrange` before writing.
   * Defaults to true because most learned policies should not exceed actuator limits.
   */
  clamp?: boolean;
  /**
   * Leave the current control unchanged when an action entry is not finite.
   * Defaults to true so a bad policy response cannot write NaN into the simulation.
   */
  skipInvalid?: boolean;
}

export interface ApplyPolicyActionToControlsResult {
  /**
   * Values actually written to `data.ctrl`, after offset, truncation, and clamping.
   */
  applied: number[];
  /**
   * Actuator indices that were not written because the corresponding action value
   * was not finite and `skipInvalid` was enabled.
   */
  skipped: number[];
  actuatorOffset: number;
}

export function clampPolicyActionValue(
  model: MujocoModel,
  actuatorIndex: number,
  value: number
) {
  const ranges = model.actuator_ctrlrange;
  const min = ranges?.[actuatorIndex * 2] ?? -Infinity;
  const max = ranges?.[actuatorIndex * 2 + 1] ?? Infinity;
  return Math.max(min, Math.min(max, value));
}

export function applyPolicyActionToControls(
  model: MujocoModel,
  data: MujocoData,
  action: PolicyVector,
  options: ApplyPolicyActionToControlsOptions = {}
): ApplyPolicyActionToControlsResult {
  const actuatorOffset = options.actuatorOffset ?? 0;
  const actionSize = options.actionSize ?? action.length;
  const shouldClamp = options.clamp ?? true;
  const shouldSkipInvalid = options.skipInvalid ?? true;
  const count = Math.max(
    0,
    Math.min(actionSize, action.length, data.ctrl.length - actuatorOffset, model.nu - actuatorOffset)
  );
  const applied: number[] = [];
  const skipped: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const actuatorIndex = actuatorOffset + index;
    const value = Number(action[index]);
    if (shouldSkipInvalid && !Number.isFinite(value)) {
      skipped.push(actuatorIndex);
      continue;
    }
    const nextValue = shouldClamp
      ? clampPolicyActionValue(model, actuatorIndex, value)
      : value;
    data.ctrl[actuatorIndex] = nextValue;
    applied.push(nextValue);
  }

  return { applied, skipped, actuatorOffset };
}
