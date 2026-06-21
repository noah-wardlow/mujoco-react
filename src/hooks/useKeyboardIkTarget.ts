/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { KeyboardIkTargetAction, KeyboardIkTargetBinding, KeyboardIkTargetConfig } from '../types';

const DEFAULT_TRANSLATE_SPEED = 0.25;
const DEFAULT_ROTATE_SPEED = 1.0;

const _translation = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _quat = new THREE.Quaternion();

function actionSign(action: KeyboardIkTargetAction): 1 | -1 {
  return action.endsWith('+') ? 1 : -1;
}

function actionBase(action: KeyboardIkTargetAction) {
  return action.slice(0, -1);
}

function applyRotation(
  target: THREE.Object3D,
  action: KeyboardIkTargetAction,
  amount: number,
  frame: 'world' | 'target',
) {
  const base = actionBase(action);
  if (base === 'pitch') {
    _axis.set(1, 0, 0);
  } else if (base === 'yaw') {
    _axis.set(0, 1, 0);
  } else if (base === 'roll') {
    _axis.set(0, 0, 1);
  } else {
    return;
  }

  _quat.setFromAxisAngle(_axis, amount);
  if (frame === 'target') {
    target.quaternion.multiply(_quat);
  } else {
    target.quaternion.premultiply(_quat);
  }
}

function addTranslation(action: KeyboardIkTargetAction, amount: number) {
  switch (action) {
    case 'x+':
      _translation.x += amount;
      break;
    case 'x-':
      _translation.x -= amount;
      break;
    case 'y+':
      _translation.y += amount;
      break;
    case 'y-':
      _translation.y -= amount;
      break;
    case 'z+':
      _translation.z += amount;
      break;
    case 'z-':
      _translation.z -= amount;
      break;
  }
}

/**
 * Moves an existing IK target from keyboard input.
 *
 * This hook is intentionally robot-agnostic: it only edits the target owned by
 * `useIkController`, then lets the normal IK solver write robot controls.
 */
export function useKeyboardIkTarget(config: KeyboardIkTargetConfig | null) {
  const pressedRef = useRef(new Set<string>());
  const wasActiveRef = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;

  const boundCodes = useMemo(() => {
    return new Set((config?.bindings ?? []).map((binding) => binding.code));
  }, [config?.bindings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = configRef.current;
      if (!current || current.enabled === false || !boundCodes.has(event.code)) return;
      if (current.preventDefault !== false) event.preventDefault();
      pressedRef.current.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const current = configRef.current;
      if (boundCodes.has(event.code) && current?.preventDefault !== false) {
        event.preventDefault();
      }
      pressedRef.current.delete(event.code);
    };
    const onBlur = () => {
      pressedRef.current.clear();
      wasActiveRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [boundCodes]);

  useFrame((_state, delta) => {
    const current = configRef.current;
    const controller = current?.controller;
    if (!current || current.enabled === false || !controller) {
      wasActiveRef.current = false;
      return;
    }

    const activeBindings: KeyboardIkTargetBinding[] = [];
    for (const binding of current.bindings) {
      if (pressedRef.current.has(binding.code)) activeBindings.push(binding);
    }

    if (activeBindings.length === 0) {
      wasActiveRef.current = false;
      return;
    }

    if (!wasActiveRef.current) {
      if (current.syncOnStart !== false) controller.syncTargetToSite();
      if (current.autoEnableIk !== false && !controller.ikEnabledRef.current) {
        controller.setIkEnabled(true);
      }
    }
    wasActiveRef.current = true;

    const target = controller.ikTargetRef.current;
    if (!target) return;

    const frame = current.frame ?? 'world';
    _translation.set(0, 0, 0);

    for (const binding of activeBindings) {
      const translateSpeed = binding.translateSpeed ?? current.translateSpeed ?? DEFAULT_TRANSLATE_SPEED;
      const rotateSpeed = binding.rotateSpeed ?? current.rotateSpeed ?? DEFAULT_ROTATE_SPEED;
      const amount = actionSign(binding.action) * delta;
      const base = actionBase(binding.action);

      if (base === 'x' || base === 'y' || base === 'z') {
        addTranslation(binding.action, translateSpeed * delta);
      } else {
        applyRotation(target, binding.action, rotateSpeed * amount, frame);
      }
    }

    if (_translation.lengthSq() > 0) {
      if (frame === 'target') _translation.applyQuaternion(target.quaternion);
      target.position.add(_translation);
    }
  });
}
