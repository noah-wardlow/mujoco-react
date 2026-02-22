/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createControllerHook } from '../core/createController';
import { useMujocoContext, useBeforePhysicsStep } from '../core/MujocoSimProvider';
import { GenericIK } from '../core/GenericIK';
import { findSiteByName } from '../core/SceneLoader';
import type { IkConfig, IkContextValue, IKSolveFn, MujocoData } from '../types';

// Preallocated temp for syncGizmoToSite
const _syncMat4 = new THREE.Matrix4();

function syncGizmoToSite(data: MujocoData, siteId: number, target: THREE.Group) {
  if (siteId === -1) return;
  const sitePos = data.site_xpos.subarray(siteId * 3, siteId * 3 + 3);
  const siteMat = data.site_xmat.subarray(siteId * 9, siteId * 9 + 9);
  target.position.set(sitePos[0], sitePos[1], sitePos[2]);
  _syncMat4.set(
    siteMat[0], siteMat[1], siteMat[2], 0,
    siteMat[3], siteMat[4], siteMat[5], 0,
    siteMat[6], siteMat[7], siteMat[8], 0,
    0, 0, 0, 1,
  );
  target.quaternion.setFromRotationMatrix(_syncMat4);
}

export const useIkController = createControllerHook<IkConfig, IkContextValue>(
  { name: 'useIkController', defaultConfig: { damping: 0.01, maxIterations: 50 } },
  function useIkControllerImpl(config) {
    const { mjModelRef, mjDataRef, mujocoRef, resetCallbacks, status } =
      useMujocoContext();

    // All IK state lives here
    const ikEnabledRef = useRef(false);
    const ikCalculatingRef = useRef(false);
    const ikTargetRef = useRef<THREE.Group>(new THREE.Group());
    const siteIdRef = useRef(-1);
    const genericIkRef = useRef<GenericIK>(new GenericIK(mujocoRef.current));
    const firstIkEnableRef = useRef(true);
    const needsInitialSync = useRef(true);

    const gizmoAnimRef = useRef({
      active: false,
      startPos: new THREE.Vector3(),
      endPos: new THREE.Vector3(),
      startRot: new THREE.Quaternion(),
      endRot: new THREE.Quaternion(),
      startTime: 0,
      duration: 1000,
    });

    // Resolve site ID when model loads or config changes
    useEffect(() => {
      if (!config) {
        siteIdRef.current = -1;
        return;
      }
      const model = mjModelRef.current;
      if (!model || status !== 'ready') {
        siteIdRef.current = -1;
        return;
      }
      siteIdRef.current = findSiteByName(model, config.siteName);
      const data = mjDataRef.current;
      if (data && ikTargetRef.current) {
        syncGizmoToSite(data, siteIdRef.current, ikTargetRef.current);
      }
    }, [config?.siteName, status, mjModelRef, mjDataRef, config]);

    // IK solve function
    const ikSolveFn = useCallback(
      (pos: THREE.Vector3, quat: THREE.Quaternion, currentQ: number[]): number[] | null => {
        if (!config) return null;
        if (config.ikSolveFn) return config.ikSolveFn(pos, quat, currentQ);
        const model = mjModelRef.current;
        const data = mjDataRef.current;
        if (!model || !data || siteIdRef.current === -1) return null;
        return genericIkRef.current.solve(
          model, data, siteIdRef.current, config.numJoints,
          pos, quat, currentQ,
          { damping: config.damping, maxIterations: config.maxIterations },
        );
      },
      [config, mjModelRef, mjDataRef],
    );
    const ikSolveFnRef = useRef<IKSolveFn>(ikSolveFn);
    ikSolveFnRef.current = ikSolveFn;

    // Gizmo animation + one-time initial sync
    useFrame(() => {
      if (!config) return;

      if (needsInitialSync.current && siteIdRef.current !== -1) {
        const data = mjDataRef.current;
        if (data && ikTargetRef.current) {
          syncGizmoToSite(data, siteIdRef.current, ikTargetRef.current);
          needsInitialSync.current = false;
        }
      }

      const ga = gizmoAnimRef.current;
      const target = ikTargetRef.current;
      if (!ga.active || !target) return;

      const now = performance.now();
      const elapsed = now - ga.startTime;
      const t = Math.min(elapsed / ga.duration, 1.0);
      const ease = 1 - Math.pow(1 - t, 3);
      target.position.lerpVectors(ga.startPos, ga.endPos, ease);
      target.quaternion.slerpQuaternions(ga.startRot, ga.endRot, ease);
      if (t >= 1.0) ga.active = false;
    });

    // IK solve in physics loop
    useBeforePhysicsStep((model, data) => {
      if (!config || !ikEnabledRef.current) {
        ikCalculatingRef.current = false;
        return;
      }
      const target = ikTargetRef.current;
      if (!target) return;

      ikCalculatingRef.current = true;
      const numJoints = config.numJoints;
      const currentQ: number[] = [];
      for (let i = 0; i < numJoints; i++) currentQ.push(data.qpos[i]);
      const solution = ikSolveFnRef.current(target.position, target.quaternion, currentQ);
      if (solution) {
        for (let i = 0; i < numJoints; i++) data.ctrl[i] = solution[i];
      }
    });

    // Reset callback
    useEffect(() => {
      if (!config) return;
      const cb = () => {
        const data = mjDataRef.current;
        if (data && ikTargetRef.current) {
          syncGizmoToSite(data, siteIdRef.current, ikTargetRef.current);
        }
        gizmoAnimRef.current.active = false;
        firstIkEnableRef.current = true;
        ikEnabledRef.current = false;
        needsInitialSync.current = true;
      };
      resetCallbacks.current.add(cb);
      return () => { resetCallbacks.current.delete(cb); };
    }, [resetCallbacks, mjDataRef, config]);

    // --- API methods ---

    const setIkEnabled = useCallback(
      (enabled: boolean) => {
        ikEnabledRef.current = enabled;
        const data = mjDataRef.current;
        if (enabled && data && !gizmoAnimRef.current.active && ikTargetRef.current) {
          syncGizmoToSite(data, siteIdRef.current, ikTargetRef.current);
          firstIkEnableRef.current = false;
        }
      },
      [mjDataRef],
    );

    const syncTargetToSiteApi = useCallback(() => {
      const data = mjDataRef.current;
      const target = ikTargetRef.current;
      if (data && target) syncGizmoToSite(data, siteIdRef.current, target);
    }, [mjDataRef]);

    const solveIK = useCallback(
      (pos: THREE.Vector3, quat: THREE.Quaternion, currentQ: number[]): number[] | null => {
        return ikSolveFnRef.current(pos, quat, currentQ);
      },
      [],
    );

    const moveTarget = useCallback(
      (pos: THREE.Vector3, duration = 0) => {
        if (!ikEnabledRef.current) setIkEnabled(true);
        const target = ikTargetRef.current;
        if (!target) return;

        const targetPos = pos.clone();
        const targetRot = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.PI, 0, 0),
        );

        if (duration > 0) {
          const ga = gizmoAnimRef.current;
          ga.active = true;
          ga.startPos.copy(target.position);
          ga.endPos.copy(targetPos);
          ga.startRot.copy(target.quaternion);
          ga.endRot.copy(targetRot);
          ga.startTime = performance.now();
          ga.duration = duration;
        } else {
          gizmoAnimRef.current.active = false;
          target.position.copy(targetPos);
          target.quaternion.copy(targetRot);
        }
      },
      [setIkEnabled],
    );

    const getGizmoStats = useCallback(
      (): { pos: THREE.Vector3; rot: THREE.Euler } | null => {
        const target = ikTargetRef.current;
        if (!ikCalculatingRef.current || !target) return null;
        return {
          pos: target.position.clone(),
          rot: new THREE.Euler().setFromQuaternion(target.quaternion),
        };
      },
      [],
    );

    const contextValue = useMemo<IkContextValue>(
      () => ({
        ikEnabledRef,
        ikCalculatingRef,
        ikTargetRef,
        siteIdRef,
        setIkEnabled,
        moveTarget,
        syncTargetToSite: syncTargetToSiteApi,
        solveIK,
        getGizmoStats,
      }),
      [setIkEnabled, moveTarget, syncTargetToSiteApi, solveIK, getGizmoStats],
    );

    if (!config) return null;

    return contextValue;
  },
);
