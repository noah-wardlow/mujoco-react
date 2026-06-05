/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef } from 'react';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { buildObservation } from '../core/ObservationBuilder';
import type { ObservationConfig, ObservationHandle, ObservationResult } from '../types';

const EMPTY_OBSERVATION: ObservationResult = {
  values: new Float32Array(0),
  layout: [],
};

/**
 * Live observation reader for policy loops and telemetry.
 *
 * The handle is stable; call `read()` inside callbacks to sample the latest
 * MuJoCo model/data state without forcing React renders.
 */
export function useObservation(config: ObservationConfig): ObservationHandle {
  const { mjModelRef, mjDataRef } = useMujocoContext();
  const configRef = useRef(config);
  configRef.current = config;

  return useMemo(() => ({
    read() {
      const model = mjModelRef.current;
      const data = mjDataRef.current;
      if (!model || !data) return EMPTY_OBSERVATION;
      return buildObservation(model, data, configRef.current);
    },
    readValues() {
      return this.read().values;
    },
  }), [mjDataRef, mjModelRef]);
}
