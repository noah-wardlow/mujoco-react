/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useMujocoSim } from '../core/MujocoSimProvider';
import { getName } from '../core/SceneLoader';
import type { ActuatorInfo } from '../types';

/**
 * Returns a stable array of actuator metadata for building control UIs.
 * Computed once when the model loads. Consumer reads/writes data.ctrl[id] directly.
 */
export function useActuators(): ActuatorInfo[] {
  const { mjModelRef, status } = useMujocoSim();

  return useMemo(() => {
    if (status !== 'ready') return [];
    const model = mjModelRef.current;
    if (!model) return [];

    const actuators: ActuatorInfo[] = [];
    for (let i = 0; i < model.nu; i++) {
      const name = getName(model, model.name_actuatoradr[i]);
      const lo = model.actuator_ctrlrange[i * 2];
      const hi = model.actuator_ctrlrange[i * 2 + 1];
      const hasRange = lo < hi;
      const range: [number, number] = hasRange
        ? [lo, hi]
        : [-Infinity, Infinity];
      actuators.push({ id: i, name, range });
    }
    return actuators;
  }, [status, mjModelRef]);
}
