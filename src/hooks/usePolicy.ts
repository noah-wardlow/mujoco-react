/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * usePolicy — policy decimation loop hook (spec 10.1)
 */

import { useRef } from 'react';
import { useMujoco, useBeforePhysicsStep } from '../core/MujocoSimProvider';
import type { PolicyConfig } from '../types';

/**
 * Framework-agnostic policy execution hook.
 *
 * Manages a decimation loop: calls `onObservation` to build observations
 * at the specified frequency, then calls `onAction` to apply the policy output.
 * The actual inference (ONNX, TF.js, custom) is the consumer's responsibility.
 *
 * @param config Policy configuration
 * @returns { step, isRunning } control handles
 */
export function usePolicy(config: PolicyConfig) {
  const { mjModelRef } = useMujoco();
  const lastActionTimeRef = useRef(0);
  const lastActionRef = useRef<Float32Array | Float64Array | number[] | null>(null);
  const isRunningRef = useRef(true);
  const configRef = useRef(config);
  configRef.current = config;

  useBeforePhysicsStep((model, data) => {
    if (!isRunningRef.current) return;

    const cfg = configRef.current;
    const dt = model.opt?.timestep ?? 0.002;
    const interval = 1.0 / cfg.frequency;

    // Check if it's time for a new action
    if (data.time - lastActionTimeRef.current >= interval) {
      // Build observation
      const obs = cfg.onObservation(model, data);

      // Apply action (consumer does inference inline or uses cached result)
      cfg.onAction(obs, model, data);

      lastActionTimeRef.current = data.time;
      lastActionRef.current = obs;
    }
  });

  return {
    get isRunning() { return isRunningRef.current; },
    start: () => { isRunningRef.current = true; },
    stop: () => { isRunningRef.current = false; },
    get lastObservation() { return lastActionRef.current; },
  };
}
