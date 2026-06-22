/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stable React handle for named policy observations.
 */

import { useMemo, useRef } from 'react';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { readNamedObservation } from '../policyObservation';
import type {
  NamedObservationOptions,
  NamedObservationResult,
} from '../policyObservation';

const EMPTY_NAMED_OBSERVATION: NamedObservationResult = {
  values: new Float32Array(0),
  layout: [],
};

export interface NamedObservationHandle {
  read: () => NamedObservationResult;
  readValues: () => Float32Array | Float64Array;
}

export function useNamedObservation(options: NamedObservationOptions): NamedObservationHandle {
  const { mjModelRef, mjDataRef } = useMujocoContext();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  return useMemo(() => ({
    read() {
      const model = mjModelRef.current;
      const data = mjDataRef.current;
      if (!model || !data) return EMPTY_NAMED_OBSERVATION;
      return readNamedObservation(model, data, optionsRef.current);
    },
    readValues() {
      return this.read().values;
    },
  }), [mjDataRef, mjModelRef]);
}
