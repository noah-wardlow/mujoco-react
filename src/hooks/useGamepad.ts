/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useGamepad — gamepad teleoperation hook (spec 12.2)
 */

import { useEffect, useRef } from 'react';
import { useMujocoSim, useBeforePhysicsStep } from '../core/MujocoSimProvider';
import { findActuatorByName } from '../core/SceneLoader';

interface GamepadConfig {
  /** Map gamepad axis index to actuator name. */
  axes?: Record<number, string>;
  /** Map gamepad button index to actuator name. */
  buttons?: Record<number, string>;
  /** Axis deadzone. Default: 0.1. */
  deadzone?: number;
  /** Scale factor for axis values. Default: 1.0. */
  scale?: number;
  /** Gamepad index. Default: 0 (first connected). */
  gamepadIndex?: number;
  enabled?: boolean;
}

/**
 * Map gamepad axes and buttons to actuator controls.
 * Axes map their -1..1 value (scaled) to the actuator.
 * Buttons map their 0..1 pressed value to the actuator.
 */
export function useGamepad(config: GamepadConfig) {
  const { mjModelRef, status } = useMujocoSim();
  const configRef = useRef(config);
  configRef.current = config;

  // Cache actuator IDs
  const axisCacheRef = useRef(new Map<number, number>());
  const buttonCacheRef = useRef(new Map<number, number>());

  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;
    axisCacheRef.current.clear();
    buttonCacheRef.current.clear();
    for (const [idx, name] of Object.entries(config.axes ?? {})) {
      axisCacheRef.current.set(Number(idx), findActuatorByName(model, name));
    }
    for (const [idx, name] of Object.entries(config.buttons ?? {})) {
      buttonCacheRef.current.set(Number(idx), findActuatorByName(model, name));
    }
  }, [config.axes, config.buttons, status, mjModelRef]);

  useBeforePhysicsStep((_model, data) => {
    const cfg = configRef.current;
    if (cfg.enabled === false) return;

    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return;
    const gp = gamepads[cfg.gamepadIndex ?? 0];
    if (!gp) return;

    const deadzone = cfg.deadzone ?? 0.1;
    const scale = cfg.scale ?? 1.0;

    for (const [axisIdx, actId] of axisCacheRef.current) {
      if (actId < 0 || axisIdx >= gp.axes.length) continue;
      let val = gp.axes[axisIdx];
      if (Math.abs(val) < deadzone) val = 0;
      data.ctrl[actId] = val * scale;
    }

    for (const [btnIdx, actId] of buttonCacheRef.current) {
      if (actId < 0 || btnIdx >= gp.buttons.length) continue;
      data.ctrl[actId] = gp.buttons[btnIdx].value;
    }
  });
}
