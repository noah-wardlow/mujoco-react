/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useContacts — structured contact query hook (spec 2.4)
 * useContactEvents — contact enter/exit events (spec 2.5)
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMujocoContext, useAfterPhysicsStep } from '../core/MujocoSimProvider';
import { findBodyByName, getName } from '../core/SceneLoader';
import { getContact } from '../types';
import type { Bodies, ContactInfo, MujocoModel } from '../types';

// Cache geom names per model to avoid cross-model id collisions.
const geomNameCacheByModel = new WeakMap<MujocoModel, Map<number, string>>();

function getGeomNameCached(model: MujocoModel, geomId: number): string {
  let perModel = geomNameCacheByModel.get(model);
  if (!perModel) {
    perModel = new Map<number, string>();
    geomNameCacheByModel.set(model, perModel);
  }

  let name = perModel.get(geomId);
  if (name === undefined) {
    name = getName(model, model.name_geomadr[geomId]);
    perModel.set(geomId, name);
  }
  return name;
}

/**
 * Track contacts for a specific body (or all contacts if no body specified).
 * Calls the callback every physics frame with current contact list.
 * Reads `data.ncon` first to avoid allocating for zero contacts.
 */
export function useContacts(
  bodyName?: Bodies,
  callback?: (contacts: ContactInfo[]) => void,
): React.RefObject<ContactInfo[]> {
  const { mjModelRef, status } = useMujocoContext();
  const contactsRef = useRef<ContactInfo[]>([]);
  const bodyIdRef = useRef(-1);
  const bodyResolvedRef = useRef(false);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!bodyName) {
      bodyIdRef.current = -1;
      bodyResolvedRef.current = true;
      return;
    }
    bodyResolvedRef.current = false;
    if (status !== 'ready') return;
    const model = mjModelRef.current;
    if (!model) return;
    bodyIdRef.current = findBodyByName(model, bodyName);
    bodyResolvedRef.current = true;
  }, [bodyName, status, mjModelRef]);

  useAfterPhysicsStep((model, data) => {
    // Resolve body id lazily once model exists, to avoid missing the first ready frame.
    if (bodyName && !bodyResolvedRef.current) {
      bodyIdRef.current = findBodyByName(model, bodyName);
      bodyResolvedRef.current = true;
    }

    const ncon = data.ncon;
    if (ncon === 0) {
      if (contactsRef.current.length > 0) contactsRef.current = [];
      callbackRef.current?.([]);
      return;
    }

    const contacts: ContactInfo[] = [];
    const filterBody = bodyIdRef.current;

    for (let i = 0; i < ncon; i++) {
      const c = getContact(data, i);
      if (!c) break;
      // Filter by body if specified
      if (filterBody >= 0) {
        const b1 = model.geom_bodyid[c.geom1];
        const b2 = model.geom_bodyid[c.geom2];
        if (b1 !== filterBody && b2 !== filterBody) continue;
      }
      contacts.push({
        geom1: c.geom1,
        geom1Name: getGeomNameCached(model, c.geom1),
        geom2: c.geom2,
        geom2Name: getGeomNameCached(model, c.geom2),
        pos: [c.pos[0], c.pos[1], c.pos[2]],
        depth: c.dist,
      });
    }
    contactsRef.current = contacts;
    callbackRef.current?.(contacts);
  });

  return contactsRef;
}

/**
 * Contact enter/exit events for a specific body (spec 2.5).
 * Tracks which geom pairs are in contact frame-to-frame and fires
 * onEnter/onExit callbacks on transitions.
 */
export function useContactEvents(
  bodyName: Bodies,
  handlers: {
    onEnter?: (info: ContactInfo) => void;
    onExit?: (info: ContactInfo) => void;
  },
) {
  const prevPairsRef = useRef(new Set<string>());
  const onEnterRef = useRef(handlers.onEnter);
  const onExitRef = useRef(handlers.onExit);
  onEnterRef.current = handlers.onEnter;
  onExitRef.current = handlers.onExit;

  const prevContactMapRef = useRef(new Map<string, ContactInfo>());

  const onContacts = useCallback((contacts: ContactInfo[]) => {
    const currentPairs = new Set<string>();
    const currentMap = new Map<string, ContactInfo>();

    for (const c of contacts) {
      const key = `${Math.min(c.geom1, c.geom2)}_${Math.max(c.geom1, c.geom2)}`;
      currentPairs.add(key);
      currentMap.set(key, c);
    }

    // New contacts (enter)
    for (const key of currentPairs) {
      if (!prevPairsRef.current.has(key)) {
        onEnterRef.current?.(currentMap.get(key)!);
      }
    }

    // Lost contacts (exit)
    for (const key of prevPairsRef.current) {
      if (!currentPairs.has(key)) {
        const prev = prevContactMapRef.current.get(key);
        if (prev) onExitRef.current?.(prev);
      }
    }

    prevPairsRef.current = currentPairs;
    prevContactMapRef.current = currentMap;
  }, []);

  useContacts(bodyName, onContacts);
}
