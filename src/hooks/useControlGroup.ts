/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed, named control groups. Define the group once (like a zod schema or a
 * tanstack route), then read/set actuators by name with inferred keys — no
 * positional arrays, no `as const`, no owner bookkeeping.
 */

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { findActuatorByName, getActuatorControlAddress } from '../core/SceneLoader';
import { useMujocoContext } from '../core/MujocoSimProvider';
import { useControlWriter, type ControlWriterOptions } from './useControlWriter';
import type { Actuators } from '../types';

type StringKeyOf<T> = Extract<keyof T, string>;
type ControlDefinitionMap = Record<string, Actuators>;
type ControlValues<K extends string> = Partial<Record<K, number>>;

function objectKeys<T extends object>(value: T): StringKeyOf<T>[] {
  return Object.keys(value) as StringKeyOf<T>[];
}

function singleControlValue<K extends string>(name: K, value: number): ControlValues<K> {
  const values: ControlValues<K> = {};
  values[name] = value;
  return values;
}

/**
 * A typed description of a set of actuators, keyed by name. Create it once with
 * {@link controlGroup} and reuse it across controllers and scripts; the key
 * union flows through to {@link useControlGroup}.
 */
export interface ControlGroup<K extends Actuators = Actuators> {
  readonly keys: readonly K[];
}

/**
 * Declare a named control group. With the Vite plugin / codegen active, names
 * are constrained to the model's registered actuators (a wrong or stale name is
 * a compile error). Without it, the literal names you pass are still inferred —
 * no `as const` required (the `const` type parameter captures them).
 */
export function controlGroup<const T extends readonly Actuators[]>(
  names: T
): ControlGroup<T[number]> {
  return { keys: names };
}

export interface DefinedControls<TControls extends ControlDefinitionMap = ControlDefinitionMap> {
  readonly controls: TControls;
  readonly aliases: readonly StringKeyOf<TControls>[];
  readonly keys: readonly TControls[StringKeyOf<TControls>][];
}

export function defineControls<const TControls extends ControlDefinitionMap>(
  controls: TControls
): DefinedControls<TControls> {
  const aliases = objectKeys(controls);
  return {
    controls,
    aliases,
    keys: aliases.map((alias) => controls[alias]),
  };
}

export interface ControlGroupSetOptions {
  /** Write even when another control writer owns one of these actuators. */
  force?: boolean;
}

export interface ControlGroupHandle<K extends string> {
  /** The cooperative-ownership identity used for conflict detection. */
  owner: string;
  /** Set a single actuator by name. Returns false if blocked by a conflict. */
  set(name: K, value: number, options?: ControlGroupSetOptions): boolean;
  /** Set one or more actuators by name. Returns false if blocked by a conflict. */
  patch(values: ControlValues<K>, options?: ControlGroupSetOptions): boolean;
  /** Write values in the same order as the declared control group. */
  write(values: ArrayLike<number>, options?: ControlGroupSetOptions): boolean;
  /** Read one actuator value by name. */
  get(name: K): number;
  /** Read the current control value of every actuator in the group, by name. */
  read(): Record<K, number>;
  /** Whether this group can currently write (no unresolved conflicts). */
  canWrite(): boolean;
  /** Release this group's actuator ownership. */
  release(): void;
}

export type UseControlGroupOptions = Omit<ControlWriterOptions, 'owner' | 'selector'> & {
  /** Human-readable conflict label. */
  label?: string;
  /** Override the generated conflict owner id. Prefer `label` for normal use. */
  owner?: string;
};

export interface ControlsHandle<TControls extends ControlDefinitionMap> {
  /** The cooperative-ownership identity used for conflict detection. */
  owner: string;
  /** Set one alias by name. Returns false if blocked by a conflict. */
  set(name: StringKeyOf<TControls>, value: number, options?: ControlGroupSetOptions): boolean;
  /** Set one or more aliases by name. Returns false if blocked by a conflict. */
  patch(values: ControlValues<StringKeyOf<TControls>>, options?: ControlGroupSetOptions): boolean;
  /** Write values in the same order as the `defineControls()` object. */
  write(values: ArrayLike<number>, options?: ControlGroupSetOptions): boolean;
  /** Read one alias value by name. */
  get(name: StringKeyOf<TControls>): number;
  /** Read every alias value. */
  read(): Record<StringKeyOf<TControls>, number>;
  /** Whether this group can currently write (no unresolved conflicts). */
  canWrite(): boolean;
  /** Release this group's actuator ownership. */
  release(): void;
}

export function useControlGroup<K extends Actuators>(
  group: ControlGroup<K>,
  options: UseControlGroupOptions = {}
): ControlGroupHandle<K> {
  const generatedOwner = useId();
  const owner = options.owner ?? options.label ?? `control-group:${generatedOwner}`;
  const { mjModelRef, mjDataRef, status } = useMujocoContext();

  const names = group.keys;
  const namesRef = useRef(names);
  namesRef.current = names;
  const namesKey = names.join('\u0000');

  // Cooperative ownership / conflict detection via the existing writer.
  const selector = useMemo(
    () => ({ actuators: names }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namesKey]
  );
  const { canWrite, release } = useControlWriter({ ...options, owner, selector });

  // Direct name -> actuator index map: absolute and joint-topology independent,
  // so coupled actuators (e.g. a tendon gripper) still resolve by name.
  const indicesRef = useRef<number[]>([]);
  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') {
      indicesRef.current = [];
      return;
    }
    indicesRef.current = namesRef.current.map((name) => {
      const id = findActuatorByName(model, name);
      if (id < 0) {
        console.warn(`[mujoco-react] useControlGroup: actuator "${name}" was not found.`);
      }
      return getActuatorControlAddress(model, id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mjModelRef, status, namesKey]);

  const patch = useCallback(
    (values: ControlValues<K>, setOptions: ControlGroupSetOptions = {}) => {
      const data = mjDataRef.current;
      if (!data) return false;
      if (!setOptions.force && !canWrite()) return false;
      const groupNames = namesRef.current;
      const indices = indicesRef.current;
      for (const [i, name] of groupNames.entries()) {
        const value = values[name];
        if (value === undefined) continue;
        const adr = indices[i];
        if (adr >= 0) data.ctrl[adr] = value;
      }
      return true;
    },
    [canWrite, mjDataRef]
  );

  const write = useCallback(
    (values: ArrayLike<number>, setOptions: ControlGroupSetOptions = {}) => {
      const data = mjDataRef.current;
      if (!data) return false;
      if (!setOptions.force && !canWrite()) return false;
      const groupNames = namesRef.current;
      const indices = indicesRef.current;
      for (let i = 0; i < Math.min(groupNames.length, values.length); i += 1) {
        const adr = indices[i];
        if (adr >= 0) data.ctrl[adr] = values[i];
      }
      return true;
    },
    [canWrite, mjDataRef]
  );

  const set = useCallback(
    (name: K, value: number, setOptions?: ControlGroupSetOptions) => (
      patch(singleControlValue(name, value), setOptions)
    ),
    [patch]
  );

  const read = useCallback((): Record<K, number> => {
    const data = mjDataRef.current;
    const groupNames = namesRef.current;
    const indices = indicesRef.current;
    const result = {} as Record<K, number>;
    for (const [i, name] of groupNames.entries()) {
      const adr = indices[i];
      result[name] = data && adr >= 0 ? data.ctrl[adr] ?? 0 : 0;
    }
    return result;
  }, [mjDataRef]);

  const get = useCallback((name: K) => read()[name], [read]);

  return useMemo(
    () => ({ owner, set, patch, write, get, read, canWrite, release }),
    [owner, set, patch, write, get, read, canWrite, release]
  );
}

export function useControls<TControls extends ControlDefinitionMap>(
  definition: DefinedControls<TControls>,
  options: UseControlGroupOptions = {}
): ControlsHandle<TControls> {
  const group = useControlGroup(controlGroup(definition.keys), options);
  const controlsRef = useRef(definition.controls);
  const aliasesRef = useRef(definition.aliases);
  controlsRef.current = definition.controls;
  aliasesRef.current = definition.aliases;

  const set = useCallback(
    (name: StringKeyOf<TControls>, value: number, setOptions?: ControlGroupSetOptions) => (
      group.set(controlsRef.current[name], value, setOptions)
    ),
    [group]
  );

  const patch = useCallback(
    (values: ControlValues<StringKeyOf<TControls>>, setOptions?: ControlGroupSetOptions) => {
      const next: ControlValues<Actuators> = {};
      for (const alias of aliasesRef.current) {
        const value = values[alias];
        if (value !== undefined) next[controlsRef.current[alias]] = value;
      }
      return group.patch(next, setOptions);
    },
    [group]
  );

  const get = useCallback(
    (name: StringKeyOf<TControls>) => group.get(controlsRef.current[name]),
    [group]
  );

  const read = useCallback((): Record<StringKeyOf<TControls>, number> => {
    const values = group.read();
    const result = {} as Record<StringKeyOf<TControls>, number>;
    for (const alias of aliasesRef.current) {
      result[alias] = values[controlsRef.current[alias]] ?? 0;
    }
    return result;
  }, [group]);

  return useMemo(
    () => ({
      owner: group.owner,
      set,
      patch,
      write: group.write,
      get,
      read,
      canWrite: group.canWrite,
      release: group.release,
    }),
    [group, set, patch, get, read]
  );
}
