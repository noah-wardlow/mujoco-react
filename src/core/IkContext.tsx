/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IkContext — React context for the IK controller plugin.
 */

import { createContext, useContext } from 'react';
import * as THREE from 'three';

export interface IkContextValue {
  ikEnabledRef: React.RefObject<boolean>;
  ikCalculatingRef: React.RefObject<boolean>;
  ikTargetRef: React.RefObject<THREE.Group>;
  siteIdRef: React.RefObject<number>;
  setIkEnabled(enabled: boolean): void;
  moveTarget(pos: THREE.Vector3, duration?: number): void;
  syncTargetToSite(): void;
  solveIK(pos: THREE.Vector3, quat: THREE.Quaternion, currentQ: number[]): number[] | null;
  getGizmoStats(): { pos: THREE.Vector3; rot: THREE.Euler } | null;
}

export const IkContext = createContext<IkContextValue | null>(null);

/**
 * Access the IK controller context.
 *
 * - `useIk()` — throws if no `<IkController>` ancestor (use inside `<IkController>`)
 * - `useIk({ optional: true })` — returns `null` if no ancestor (use in components
 *   that optionally interact with IK, e.g. keyboard controllers that disable IK)
 */
export function useIk(): IkContextValue;
export function useIk(options: { optional: true }): IkContextValue | null;
export function useIk(options?: { optional?: boolean }): IkContextValue | null {
  const ctx = useContext(IkContext);
  if (!ctx && !options?.optional) {
    throw new Error('useIk() must be used inside an <IkController>');
  }
  return ctx;
}
