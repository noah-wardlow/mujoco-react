/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * createController — typed factory for BYOC (Bring Your Own Controller) plugins.
 */

import { useMemo, useRef } from 'react';

/** Shallow-compare two plain objects by own enumerable keys. */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export interface ControllerOptions<TConfig> {
  /** Unique name for this controller (used as displayName). */
  name: string;
  /** Default values merged under user-supplied config. */
  defaultConfig?: Partial<TConfig>;
}

export type ControllerComponent<TConfig> = React.FC<{
  config?: Partial<TConfig>;
  children?: React.ReactNode;
}> & {
  controllerName: string;
  defaultConfig: Partial<TConfig>;
};

/**
 * Factory that produces a typed controller component.
 *
 * Controllers are React components that plug into the MuJoCo simulation tree.
 * Inside `Impl`, use any hooks (`useMujoco`, `useBeforePhysicsStep`, etc.)
 * to interact with the physics engine.
 *
 * @example
 * ```tsx
 * const MyController = createController<{ speed: number }>(
 *   { name: 'my-controller', defaultConfig: { speed: 1.0 } },
 *   function MyControllerImpl({ config }) {
 *     useBeforePhysicsStep((_model, data) => {
 *       data.ctrl[0] = config.speed;
 *     });
 *     return null;
 *   },
 * );
 *
 * // Usage:
 * <MyController config={{ speed: 2.0 }} />
 * ```
 */
export function createController<TConfig>(
  options: ControllerOptions<TConfig>,
  Impl: React.FC<{ config: TConfig; children?: React.ReactNode }>,
): ControllerComponent<TConfig> {
  function Controller({
    config,
    children,
  }: {
    config?: Partial<TConfig>;
    children?: React.ReactNode;
  }) {
    // Stabilise config reference: inline objects get a new identity each render,
    // but the actual values rarely change.  Shallow-compare to keep the same ref.
    const configObj = (config ?? {}) as Record<string, unknown>;
    const stableRef = useRef(configObj);
    if (!shallowEqual(stableRef.current, configObj)) {
      stableRef.current = configObj;
    }
    const stableConfig = stableRef.current as Partial<TConfig>;

    const mergedConfig = useMemo(
      () => ({ ...options.defaultConfig, ...stableConfig }) as TConfig,
      [stableConfig],
    );
    return <Impl config={mergedConfig}>{children}</Impl>;
  }

  Controller.displayName = options.name;
  Controller.controllerName = options.name;
  Controller.defaultConfig = options.defaultConfig ?? ({} as Partial<TConfig>);

  return Controller as ControllerComponent<TConfig>;
}
