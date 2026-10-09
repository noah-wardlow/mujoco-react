/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useCtrl — handle-based read/write access to a named actuator's ctrl value (spec 3.1)
 */

import { useEffect, useRef, useMemo } from 'react';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { findActuatorByName, getActuatorControlAddress } from '../core/SceneLoader';
import type { Actuators, CtrlHandle } from '../types';

/**
 * Access a single actuator's control value by name.
 *
 * Returns a `CtrlHandle` with `read()` and `write()` methods that
 * operate directly on `data.ctrl` without causing React re-renders.
 */
export function useCtrl(name: Actuators, input?: number): CtrlHandle {
  const { mjModelRef, mjDataRef, status } = useMujocoContext();
  const actuatorIdRef = useRef(-1);
  const rangeRef = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;
    const id = findActuatorByName(model, name);
    const adr = getActuatorControlAddress(model, id, input);
    actuatorIdRef.current = adr;
    if (id >= 0) {
      rangeRef.current = [
        model.actuator_ctrlrange[adr * 2],
        model.actuator_ctrlrange[adr * 2 + 1],
      ];
    }
  }, [name, input, status, mjModelRef]);

  return useMemo<CtrlHandle>(() => ({
    read() {
      const data = mjDataRef.current;
      if (!data || actuatorIdRef.current < 0) return 0;
      return data.ctrl[actuatorIdRef.current];
    },
    write(value: number) {
      const data = mjDataRef.current;
      if (!data || actuatorIdRef.current < 0) return;
      data.ctrl[actuatorIdRef.current] = value;
    },
    name,
    get range(): [number, number] {
      return rangeRef.current;
    },
  }), [name, mjDataRef]);
}
