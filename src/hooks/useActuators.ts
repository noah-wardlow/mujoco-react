/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { getActuatorInfo } from '../core/SceneLoader';
import type { ActuatorInfo } from '../types';

/**
 * Returns a stable array of actuator metadata for building control UIs.
 * Computed once when the model loads. Use ctrlAdr and ctrlCount to address controls.
 */
export function useActuators(): ActuatorInfo[] {
  const { mjModelRef, status } = useMujocoContext();

  return useMemo(() => {
    if (status !== 'ready') return [];
    const model = mjModelRef.current;
    if (!model) return [];

    const actuators = Array.from({ length: model.nactuator }, (_, id) => getActuatorInfo(model, id));
    return actuators;
  }, [status, mjModelRef]);
}
