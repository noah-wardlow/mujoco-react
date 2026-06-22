/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cooperative actuator/control ownership for policies, IK, teleop, and replay.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useMujocoContext } from '../core/MujocoSimProvider';
import type { ControlGroupInfo, ControlGroupSelector, MujocoData, MujocoModel } from '../types';

export interface ControlWriterConflict {
  actuatorIndex: number;
  owner: string;
  requestedBy: string;
}

export interface ControlWriterOptions {
  owner: string;
  selector?: ControlGroupSelector;
  enabled?: boolean;
  warnOnConflict?: boolean;
  allowSameOwner?: boolean;
  onConflict?: (conflicts: ControlWriterConflict[]) => void;
}

export interface ControlWriterWriteOptions {
  force?: boolean;
}

export interface ControlWriterHandle {
  owner: string;
  group: RefObject<ControlGroupInfo | null>;
  conflicts: RefObject<ControlWriterConflict[]>;
  canWrite: () => boolean;
  read: () => Float64Array;
  write: (values: ArrayLike<number>, options?: ControlWriterWriteOptions) => boolean;
  release: () => void;
}

interface ControlWriterClaim {
  owner: string;
  token: symbol;
}

const claimsByModel = new WeakMap<MujocoModel, Map<number, ControlWriterClaim>>();

function getClaims(model: MujocoModel) {
  let claims = claimsByModel.get(model);
  if (!claims) {
    claims = new Map();
    claimsByModel.set(model, claims);
  }
  return claims;
}

function releaseClaims(model: MujocoModel | null, token: symbol) {
  if (!model) return;
  const claims = claimsByModel.get(model);
  if (!claims) return;
  for (const [actuatorIndex, claim] of claims) {
    if (claim.token === token) claims.delete(actuatorIndex);
  }
}

export function useControlWriter(options: ControlWriterOptions): ControlWriterHandle {
  const {
    owner,
    selector,
    enabled = true,
    warnOnConflict = true,
    allowSameOwner = true,
    onConflict,
  } = options;
  const { api, mjModelRef, mjDataRef, status } = useMujocoContext();
  const tokenRef = useRef(Symbol(owner));
  const claimedModelRef = useRef<MujocoModel | null>(null);
  const groupRef = useRef<ControlGroupInfo | null>(null);
  const conflictsRef = useRef<ControlWriterConflict[]>([]);
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;

  const release = useCallback(() => {
    releaseClaims(claimedModelRef.current, tokenRef.current);
    claimedModelRef.current = null;
    conflictsRef.current = [];
  }, []);

  useEffect(() => {
    release();
    if (!enabled || status !== 'ready') {
      groupRef.current = null;
      return;
    }

    const model = mjModelRef.current;
    if (!model) {
      groupRef.current = null;
      return;
    }

    const group = selector ? api.resolveControlGroup(selector) : api.getControlMap();
    groupRef.current = group;
    if (!group) return;

    const claims = getClaims(model);
    const conflicts: ControlWriterConflict[] = [];
    for (const actuatorIndex of group.ctrlAdr) {
      const existing = claims.get(actuatorIndex);
      if (
        existing &&
        existing.token !== tokenRef.current &&
        (!allowSameOwner || existing.owner !== owner)
      ) {
        conflicts.push({
          actuatorIndex,
          owner: existing.owner,
          requestedBy: owner,
        });
      }
    }

    conflictsRef.current = conflicts;
    if (conflicts.length > 0) {
      onConflictRef.current?.(conflicts);
      if (warnOnConflict) {
        console.warn(
          `[mujoco-react] Control writer "${owner}" conflicts with existing writer(s): ${conflicts
            .map((conflict) => `${conflict.actuatorIndex}:${conflict.owner}`)
            .join(', ')}`
        );
      }
      return;
    }

    for (const actuatorIndex of group.ctrlAdr) {
      claims.set(actuatorIndex, { owner, token: tokenRef.current });
    }
    claimedModelRef.current = model;

    return release;
  }, [allowSameOwner, api, enabled, mjModelRef, owner, release, selector, status, warnOnConflict]);

  const canWrite = useCallback(() => (
    enabled &&
    groupRef.current !== null &&
    conflictsRef.current.length === 0
  ), [enabled]);

  const read = useCallback(() => {
    const data = mjDataRef.current;
    const group = groupRef.current;
    if (!data || !group) return new Float64Array(0);
    return group.readCtrl(data);
  }, [mjDataRef]);

  const write = useCallback((values: ArrayLike<number>, writeOptions: ControlWriterWriteOptions = {}) => {
    const data: MujocoData | null = mjDataRef.current;
    const group = groupRef.current;
    if (!data || !group) return false;
    if (!writeOptions.force && !canWrite()) return false;
    group.writeCtrl(data, values);
    return true;
  }, [canWrite, mjDataRef]);

  return useMemo(() => ({
    owner,
    group: groupRef,
    conflicts: conflictsRef,
    canWrite,
    read,
    write,
    release,
  }), [canWrite, owner, read, release, write]);
}
