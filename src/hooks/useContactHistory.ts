/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bounded contact history for rollout verification and debugging.
 */

import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import { useAfterPhysicsStep } from '../core/MujocoSimProvider';
import { getName } from '../core/SceneLoader';
import { getContact, withContacts } from '../types';
import type { ContactInfo, MujocoModel } from '../types';

export interface ContactHistoryEntry extends ContactInfo {
  time: number;
  body1: number;
  body1Name: string;
  body2: number;
  body2Name: string;
}

export interface ContactHistoryOptions {
  maxLength?: number;
  bodyNames?: readonly string[];
  geomNames?: readonly string[];
  includeWorldBody?: boolean;
}

export interface ContactHistoryHandle {
  entries: RefObject<ContactHistoryEntry[]>;
  clear: () => void;
  countPair: (nameA: string, nameB: string) => number;
}

const geomNameCacheByModel = new WeakMap<MujocoModel, Map<number, string>>();
const bodyNameCacheByModel = new WeakMap<MujocoModel, Map<number, string>>();

function getCachedName(
  cacheByModel: WeakMap<MujocoModel, Map<number, string>>,
  model: MujocoModel,
  id: number,
  address: number
) {
  if (id < 0) return '';
  let cache = cacheByModel.get(model);
  if (!cache) {
    cache = new Map();
    cacheByModel.set(model, cache);
  }
  let name = cache.get(id);
  if (name === undefined) {
    name = getName(model, address);
    cache.set(id, name);
  }
  return name;
}

function matchesFilter(
  entry: ContactHistoryEntry,
  bodyNames: readonly string[] | undefined,
  geomNames: readonly string[] | undefined,
  includeWorldBody: boolean
) {
  if (!includeWorldBody && (entry.body1 === 0 || entry.body2 === 0)) return false;
  if (
    bodyNames &&
    !bodyNames.includes(entry.body1Name) &&
    !bodyNames.includes(entry.body2Name)
  ) {
    return false;
  }
  if (
    geomNames &&
    !geomNames.includes(entry.geom1Name) &&
    !geomNames.includes(entry.geom2Name)
  ) {
    return false;
  }
  return true;
}

export function useContactHistory(options: ContactHistoryOptions = {}): ContactHistoryHandle {
  const entriesRef = useRef<ContactHistoryEntry[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clear = useCallback(() => {
    entriesRef.current = [];
  }, []);

  const countPair = useCallback((nameA: string, nameB: string) => {
    let count = 0;
    for (const entry of entriesRef.current) {
      const matchesBodies =
        (entry.body1Name === nameA && entry.body2Name === nameB) ||
        (entry.body1Name === nameB && entry.body2Name === nameA);
      const matchesGeoms =
        (entry.geom1Name === nameA && entry.geom2Name === nameB) ||
        (entry.geom1Name === nameB && entry.geom2Name === nameA);
      if (matchesBodies || matchesGeoms) count += 1;
    }
    return count;
  }, []);

  useAfterPhysicsStep(({ model, data }) => {
    if ((data.ncon ?? 0) <= 0) return;

    const {
      maxLength = 2000,
      bodyNames,
      geomNames,
      includeWorldBody = false,
    } = optionsRef.current;
    if (maxLength <= 0) return;

    const nextEntries: ContactHistoryEntry[] = [];
    withContacts(data, (contacts) => {
      for (let index = 0; index < data.ncon; index += 1) {
        const contact = getContact(contacts, index);
        if (!contact) break;
        const body1 = model.geom_bodyid[contact.geom1] ?? -1;
        const body2 = model.geom_bodyid[contact.geom2] ?? -1;
        const entry: ContactHistoryEntry = {
          geom1: contact.geom1,
          geom2: contact.geom2,
          geom1Name: getCachedName(geomNameCacheByModel, model, contact.geom1, model.name_geomadr[contact.geom1]),
          geom2Name: getCachedName(geomNameCacheByModel, model, contact.geom2, model.name_geomadr[contact.geom2]),
          body1,
          body2,
          body1Name: body1 >= 0 ? getCachedName(bodyNameCacheByModel, model, body1, model.name_bodyadr[body1]) : '',
          body2Name: body2 >= 0 ? getCachedName(bodyNameCacheByModel, model, body2, model.name_bodyadr[body2]) : '',
          pos: [contact.pos[0], contact.pos[1], contact.pos[2]],
          depth: contact.dist,
          time: data.time,
        };
        if (matchesFilter(entry, bodyNames, geomNames, includeWorldBody)) {
          nextEntries.push(entry);
        }
      }
    });

    if (nextEntries.length === 0) return;
    entriesRef.current.push(...nextEntries);
    if (entriesRef.current.length > maxLength) {
      entriesRef.current.splice(0, entriesRef.current.length - maxLength);
    }
  });

  return {
    entries: entriesRef,
    clear,
    countPair,
  };
}
