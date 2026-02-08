/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useKeyboardTeleop — keyboard teleoperation hook (spec 12.1)
 */

import { useEffect, useRef } from 'react';
import { useMujocoSim, useBeforePhysicsStep } from '../core/MujocoSimProvider';
import { findActuatorByName } from '../core/SceneLoader';
import type { KeyboardTeleopConfig } from '../types';

/**
 * Map keyboard keys to actuator commands.
 *
 * Supports three binding modes:
 * - `delta`: Add delta to actuator value while key is held
 * - `toggle`: Toggle between two values on key press
 * - `set`: Set actuator to a fixed value while key is held
 */
export function useKeyboardTeleop(config: KeyboardTeleopConfig) {
  const { mjModelRef, mjDataRef, status } = useMujocoSim();
  const pressedRef = useRef(new Set<string>());
  const toggleStateRef = useRef(new Map<string, boolean>());
  const enabledRef = useRef(config.enabled ?? true);
  enabledRef.current = config.enabled ?? true;

  // Resolve actuator IDs
  const bindingsRef = useRef(config.bindings);
  bindingsRef.current = config.bindings;

  // Actuator ID cache
  const actuatorCacheRef = useRef(new Map<string, number>());
  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;
    const cache = new Map<string, number>();
    for (const binding of Object.values(config.bindings)) {
      if (!cache.has(binding.actuator)) {
        cache.set(binding.actuator, findActuatorByName(model, binding.actuator));
      }
    }
    actuatorCacheRef.current = cache;
  }, [config.bindings, status, mjModelRef]);

  // Key event listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      const key = e.key.toLowerCase();
      if (bindingsRef.current[key]) {
        pressedRef.current.add(key);
        // Handle toggle on keydown
        const binding = bindingsRef.current[key];
        if (binding.toggle) {
          const current = toggleStateRef.current.get(key) ?? false;
          toggleStateRef.current.set(key, !current);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Apply bindings each physics frame
  useBeforePhysicsStep((_model, data) => {
    if (!enabledRef.current) return;
    const bindings = bindingsRef.current;
    const cache = actuatorCacheRef.current;

    for (const [key, binding] of Object.entries(bindings)) {
      const actId = cache.get(binding.actuator);
      if (actId === undefined || actId < 0) continue;

      if (binding.toggle) {
        // Toggle mode: set value based on toggle state
        const state = toggleStateRef.current.get(key) ?? false;
        data.ctrl[actId] = state ? binding.toggle[1] : binding.toggle[0];
      } else if (pressedRef.current.has(key)) {
        if (binding.delta !== undefined) {
          // Delta mode: add delta while held
          data.ctrl[actId] += binding.delta;
        } else if (binding.set !== undefined) {
          // Set mode: set fixed value while held
          data.ctrl[actId] = binding.set;
        }
      }
    }
  });
}
