/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useCtrlNoise — control noise / perturbation hook (spec 3.2)
 */

import { useRef } from 'react';
import { useMujocoSim, useBeforePhysicsStep } from '../core/MujocoSimProvider';

interface CtrlNoiseConfig {
  /** Exponential filter rate (0-1). Higher = faster noise changes. Default: 0.01. */
  rate?: number;
  /** Standard deviation of Gaussian noise. Default: 0.05. */
  std?: number;
  /** Enable/disable. Default: true. */
  enabled?: boolean;
}

/**
 * Apply Gaussian noise with exponential filtering to all ctrl values.
 * Useful for robustness testing and domain randomization.
 *
 * noise[i] = (1 - rate) * noise[i] + rate * N(0, std)
 * data.ctrl[i] += noise[i]
 */
export function useCtrlNoise(config: CtrlNoiseConfig = {}) {
  const { mjModelRef } = useMujocoSim();
  const configRef = useRef(config);
  configRef.current = config;
  const noiseRef = useRef<Float64Array | null>(null);

  useBeforePhysicsStep((_model, data) => {
    const cfg = configRef.current;
    if (cfg.enabled === false) return;

    const rate = cfg.rate ?? 0.01;
    const std = cfg.std ?? 0.05;
    const nu = mjModelRef.current?.nu ?? 0;
    if (nu === 0) return;

    // Initialize noise buffer
    if (!noiseRef.current || noiseRef.current.length !== nu) {
      noiseRef.current = new Float64Array(nu);
    }

    const noise = noiseRef.current;
    for (let i = 0; i < nu; i++) {
      // Box-Muller transform for Gaussian noise
      const u1 = Math.random();
      const u2 = Math.random();
      const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

      // Exponential filter
      noise[i] = (1 - rate) * noise[i] + rate * gaussian * std;
      data.ctrl[i] += noise[i];
    }
  });
}
