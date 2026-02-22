/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useSensor / useSensors — MuJoCo sensor access hooks (spec 2.1)
 */

import { useEffect, useRef, useMemo } from 'react';
import { useMujocoContext, useAfterPhysicsStep } from '../core/MujocoSimProvider';
import { getName } from '../core/SceneLoader';
import type { SensorInfo, SensorResult } from '../types';

/**
 * Access a single MuJoCo sensor by name. Returns a ref-based value
 * updated every physics frame without causing React re-renders.
 */
export function useSensor(name: string): SensorResult {
  const { mjModelRef, mjDataRef, status } = useMujocoContext();
  const sensorIdRef = useRef(-1);
  const sensorAdrRef = useRef(0);
  const sensorDimRef = useRef(0);
  const valueRef = useRef<Float64Array>(new Float64Array(0));

  // Resolve sensor ID once model is ready
  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;
    for (let i = 0; i < model.nsensor; i++) {
      if (getName(model, model.name_sensoradr[i]) === name) {
        sensorIdRef.current = i;
        sensorAdrRef.current = model.sensor_adr[i];
        sensorDimRef.current = model.sensor_dim[i];
        valueRef.current = new Float64Array(model.sensor_dim[i]);
        return;
      }
    }
    sensorIdRef.current = -1;
  }, [name, status, mjModelRef]);

  // Update every frame after physics step
  useAfterPhysicsStep((_model, data) => {
    if (sensorIdRef.current < 0) return;
    const adr = sensorAdrRef.current;
    const dim = sensorDimRef.current;
    for (let i = 0; i < dim; i++) {
      valueRef.current[i] = data.sensordata[adr + i];
    }
  });

  return { value: valueRef, size: sensorDimRef.current };
}

/**
 * Enumerate all sensors in the loaded MuJoCo model.
 * Returns a stable array recomputed only when the model changes.
 */
export function useSensors(): SensorInfo[] {
  const { mjModelRef, status } = useMujocoContext();

  return useMemo(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return [];
    const SENSOR_TYPE_NAMES: Record<number, string> = {
      0: 'touch', 1: 'accelerometer', 2: 'velocimeter', 3: 'gyro',
      4: 'force', 5: 'torque', 6: 'magnetometer', 7: 'rangefinder',
      8: 'jointpos', 9: 'jointvel', 10: 'tendonpos', 11: 'tendonvel',
      12: 'actuatorpos', 13: 'actuatorvel', 14: 'actuatorfrc',
    };
    const result: SensorInfo[] = [];
    for (let i = 0; i < model.nsensor; i++) {
      const type = model.sensor_type[i];
      result.push({
        id: i,
        name: getName(model, model.name_sensoradr[i]),
        type,
        typeName: SENSOR_TYPE_NAMES[type] ?? `unknown(${type})`,
        dim: model.sensor_dim[i],
        adr: model.sensor_adr[i],
      });
    }
    return result;
  }, [mjModelRef, status]);
}
