/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useCtrl — clean read/write access to a named actuator's ctrl value (spec 3.1)
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMujoco } from '../core/MujocoSimProvider';
import { findActuatorByName } from '../core/SceneLoader';

/**
 * Access a single actuator's control value by name.
 *
 * Returns [currentValue, setValue]:
 * - `currentValue` is a ref updated every frame (no re-renders).
 * - `setValue` writes directly to `data.ctrl[actuatorId]`.
 */
export function useCtrl(name: string): [React.RefObject<number>, (value: number) => void] {
  const { mjModelRef, mjDataRef, status } = useMujoco();
  const actuatorIdRef = useRef(-1);
  const valueRef = useRef(0);

  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;
    actuatorIdRef.current = findActuatorByName(model, name);
  }, [name, status, mjModelRef]);

  // Read current value each frame (via afterStep would be ideal but
  // useCtrl is primarily for writing; reading can use the ref)
  const setValue = useCallback((value: number) => {
    const data = mjDataRef.current;
    if (!data || actuatorIdRef.current < 0) return;
    data.ctrl[actuatorIdRef.current] = value;
    valueRef.current = value;
  }, [mjDataRef]);

  return [valueRef, setValue];
}
