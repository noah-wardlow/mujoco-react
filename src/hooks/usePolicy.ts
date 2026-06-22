/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * usePolicy — policy decimation loop hook (spec 10.1)
 */

import { useCallback, useMemo, useRef } from 'react';
import { useBeforePhysicsStep } from '../core/MujocoSimProvider';
import type { PolicyAPI, PolicyConfig, PolicyInferenceOutput, PolicyVector } from '../types';

type PendingPolicyAction = {
  action: PolicyVector;
  observation: PolicyVector;
};

function isPromiseLike(value: unknown): value is Promise<PolicyInferenceOutput> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isPolicyActionChunk(value: PolicyInferenceOutput): value is readonly PolicyVector[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    (Array.isArray(value[0]) || ArrayBuffer.isView(value[0]))
  );
}

function toPolicyActions(output: PolicyInferenceOutput): PolicyVector[] {
  return isPolicyActionChunk(output) ? [...output] : [output];
}

function enqueuePolicyActions(
  queue: PendingPolicyAction[],
  actions: PolicyVector[],
  observation: PolicyVector,
  strategy: PolicyConfig['queueStrategy']
) {
  if (strategy === 'replace') {
    queue.splice(0, queue.length);
  }
  queue.push(...actions.map((action) => ({ action, observation })));
}

/**
 * Framework-agnostic policy execution hook.
 *
 * Manages a decimation loop: calls `onObservation` to build observations
 * at the specified frequency, then calls `onAction` to apply the policy output.
 * The actual inference (ONNX, TF.js, custom) is the consumer's responsibility.
 *
 * @param config Policy configuration
 * @returns { step, isRunning } control handles
 */
export function usePolicy(config: PolicyConfig): PolicyAPI {
  const lastActionTimeRef = useRef(0);
  const lastObservationRef = useRef<ReturnType<PolicyConfig['onObservation']> | null>(null);
  const lastActionRef = useRef<Float32Array | Float64Array | number[] | null>(null);
  const actionQueueRef = useRef<PendingPolicyAction[]>([]);
  const inFlightRef = useRef(false);
  const lastErrorRef = useRef<unknown>(null);
  const epochRef = useRef(0);
  const isRunningRef = useRef(config.enabled ?? true);
  const configRef = useRef(config);
  configRef.current = config;
  isRunningRef.current = config.enabled ?? isRunningRef.current;

  const clearQueue = useCallback(() => {
    epochRef.current += 1;
    actionQueueRef.current.splice(0, actionQueueRef.current.length);
    inFlightRef.current = false;
    lastErrorRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearQueue();
    lastActionTimeRef.current = 0;
    lastObservationRef.current = null;
    lastActionRef.current = null;
  }, [clearQueue]);

  useBeforePhysicsStep(({ model, data }) => {
    if (!isRunningRef.current) return;

    const cfg = configRef.current;
    const dt = model.opt?.timestep ?? 0.002;
    const interval = 1.0 / cfg.frequency;

    // Check if it's time for a new action
    if (data.time - lastActionTimeRef.current >= interval) {
      const queuedAction = actionQueueRef.current.shift();
      if (queuedAction) {
        cfg.onAction({
          action: queuedAction.action,
          observation: queuedAction.observation,
          model,
          data,
        });
        lastActionTimeRef.current = data.time;
        lastActionRef.current = queuedAction.action;
      }

      const prefetchThreshold = cfg.prefetchThreshold ?? 0;
      const shouldInfer = !inFlightRef.current && (!queuedAction || actionQueueRef.current.length <= prefetchThreshold);
      if (!shouldInfer) return;

      // Build observation
      const observation = cfg.onObservation({ model, data });
      const queuedActions = actionQueueRef.current.length;
      const result = cfg.infer
        ? cfg.infer({ observation, model, data, queuedActions })
        : observation;

      if (isPromiseLike(result)) {
        const epoch = epochRef.current;
        inFlightRef.current = true;
        result
          .then((output) => {
            if (epoch !== epochRef.current) return;
            enqueuePolicyActions(
              actionQueueRef.current,
              toPolicyActions(output),
              observation,
              cfg.queueStrategy ?? 'append'
            );
            lastErrorRef.current = null;
          })
          .catch((error: unknown) => {
            if (epoch !== epochRef.current) return;
            lastErrorRef.current = error;
            cfg.onError?.(error);
          })
          .finally(() => {
            if (epoch !== epochRef.current) return;
            inFlightRef.current = false;
          });
      } else {
        const actions = toPolicyActions(result);
        if (queuedAction) {
          enqueuePolicyActions(
            actionQueueRef.current,
            actions,
            observation,
            cfg.queueStrategy ?? 'append'
          );
        } else {
          const [action, ...queuedActions] = actions;
          if (!action) return;
          enqueuePolicyActions(
            actionQueueRef.current,
            queuedActions,
            observation,
            cfg.queueStrategy ?? 'append'
          );
          // Apply action. If `infer` is omitted, this preserves the legacy inline-controller path.
          cfg.onAction({ action, observation, model, data });
          lastActionRef.current = action;
        }
      }

      lastActionTimeRef.current = data.time;
      lastObservationRef.current = observation;
    }
  });

  return useMemo(() => ({
    get isRunning() { return isRunningRef.current; },
    start: () => { isRunningRef.current = true; },
    stop: () => {
      isRunningRef.current = false;
      if (configRef.current.clearQueueOnStop) reset();
    },
    clearQueue,
    reset,
    get inFlight() { return inFlightRef.current; },
    get queuedActions() { return actionQueueRef.current.length; },
    get lastObservation() { return lastObservationRef.current; },
    get lastAction() { return lastActionRef.current; },
    get lastError() { return lastErrorRef.current; },
  }), [clearQueue, reset]);
}
