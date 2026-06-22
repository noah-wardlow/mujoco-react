/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useRemotePolicy — HTTP JSON inference wrapper around usePolicy.
 */

import { useMemo, useRef } from 'react';
import { usePolicy } from './usePolicy';
import type {
  PolicyInferenceOutput,
  PolicyVector,
  RemotePolicyAPI,
  RemotePolicyConfig,
  RemotePolicyRequestInput,
  RemotePolicyResponseInfo,
  RemotePolicyStatus,
} from '../types';

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isAbortError(error: unknown) {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    error instanceof Error && error.name === 'AbortError'
  );
}

function createAbortError(message: string) {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function abortController(controller: AbortController | null, reason?: unknown) {
  if (!controller || controller.signal.aborted) return;
  if (reason !== undefined) {
    controller.abort(reason);
  } else {
    controller.abort();
  }
}

function createMergedAbortSignal(
  localSignal: AbortSignal,
  externalSignal: AbortSignal | undefined
) {
  if (!externalSignal) return localSignal;
  if (externalSignal.aborted) {
    const controller = new AbortController();
    abortController(controller, externalSignal.reason);
    return controller.signal;
  }
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([localSignal, externalSignal]);
  }

  const controller = new AbortController();
  const abortFromLocal = () => abortController(controller, localSignal.reason);
  const abortFromExternal = () => abortController(controller, externalSignal.reason);
  localSignal.addEventListener('abort', abortFromLocal, { once: true });
  externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  return controller.signal;
}

function vectorToArray(vector: PolicyVector) {
  return Array.from(vector, (value) => Number(value));
}

function isPolicyVectorArray(value: unknown): value is PolicyVector[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => Array.isArray(entry) || ArrayBuffer.isView(entry))
  );
}

function isPolicyVector(value: unknown): value is PolicyVector {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function defaultBuildRemotePolicyRequest(input: RemotePolicyRequestInput) {
  const observation = vectorToArray(input.observation);
  return {
    observation,
    state: observation,
    time: input.data.time,
    reset: input.reset,
  };
}

async function defaultReadRemotePolicyResponse(response: Response) {
  const text = await response.text();
  if (text.length === 0) return null;
  return JSON.parse(text);
}

function defaultParseRemotePolicyResponse(responseBody: unknown): PolicyInferenceOutput {
  if (responseBody && typeof responseBody === 'object') {
    const body = responseBody as {
      action?: unknown;
      actions?: unknown;
      error?: unknown;
    };

    if (typeof body.error === 'string' && body.error.length > 0) {
      throw new Error(body.error);
    }

    if (isPolicyVectorArray(body.actions) && body.actions.length > 0) {
      return body.actions;
    }

    if (isPolicyVector(body.action)) {
      return body.action;
    }
  }

  if (isPolicyVectorArray(responseBody) && responseBody.length > 0) {
    return responseBody;
  }

  if (isPolicyVector(responseBody)) {
    return responseBody;
  }

  throw new Error('Remote policy response must include `action` or `actions`.');
}

function createHttpError(response: Response, responseBody: unknown) {
  const suffix =
    responseBody && typeof responseBody === 'object' && 'error' in responseBody
      ? `: ${String((responseBody as { error?: unknown }).error)}`
      : '';
  return new Error(`Remote policy request failed with HTTP ${response.status}${suffix}`);
}

/**
 * Run a policy whose inference step lives behind an HTTP JSON endpoint.
 *
 * The hook keeps `usePolicy` responsible for timing, queueing, and pause/reset
 * behavior. This wrapper only builds requests, parses responses, and exposes
 * request metadata for HUDs and debugging.
 */
export function useRemotePolicy(config: RemotePolicyConfig): RemotePolicyAPI {
  const configRef = useRef(config);
  configRef.current = config;
  const requestCountRef = useRef(0);
  const responseCountRef = useRef(0);
  const remoteStatusRef = useRef<RemotePolicyStatus>('idle');
  const lastRequestBodyRef = useRef<unknown>(null);
  const lastResponseBodyRef = useRef<unknown>(null);
  const lastHttpStatusRef = useRef<number | null>(null);
  const lastRequestMsRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const remoteEpochRef = useRef(0);

  const policy = usePolicy({
    ...config,
    infer: async ({ observation, model, data, queuedActions }) => {
      const cfg = configRef.current;
      abortController(abortControllerRef.current, createAbortError('Remote policy request was superseded.'));
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const signal = createMergedAbortSignal(controller.signal, cfg.signal);
      const remoteEpoch = remoteEpochRef.current;
      const requestIndex = requestCountRef.current;
      const requestInput: RemotePolicyRequestInput = {
        observation,
        model,
        data,
        queuedActions,
        reset: requestIndex === 0,
        requestIndex,
        signal,
      };
      requestCountRef.current += 1;

      const requestStartedAt = now();
      const body = await (
        cfg.buildRequest?.(requestInput) ?? defaultBuildRemotePolicyRequest(requestInput)
      );
      signal.throwIfAborted();
      if (remoteEpoch !== remoteEpochRef.current) {
        throw createAbortError('Remote policy request was reset.');
      }
      lastRequestBodyRef.current = body;
      remoteStatusRef.current = 'requesting';
      cfg.onRequest?.({
        ...requestInput,
        body,
        requestStartedAt,
      });

      let response: Response | null = null;
      let responseBody: unknown = null;
      try {
        const headers = new Headers(cfg.headers);
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }

        const fetcher = cfg.fetcher ?? fetch;
        response = await fetcher(String(cfg.endpoint), {
          ...cfg.requestInit,
          method: cfg.method ?? 'POST',
          credentials: cfg.credentials,
          headers,
          signal,
          body: typeof body === 'string' ? body : JSON.stringify(body),
        });
        if (remoteEpoch === remoteEpochRef.current) {
          lastHttpStatusRef.current = response.status;
        }
        responseBody = await (
          cfg.readResponse?.(response) ?? defaultReadRemotePolicyResponse(response)
        );
        signal.throwIfAborted();
        if (remoteEpoch !== remoteEpochRef.current) {
          throw createAbortError('Remote policy request was reset.');
        }
        lastResponseBodyRef.current = responseBody;

        if (!response.ok) {
          throw createHttpError(response, responseBody);
        }

        const responseFinishedAt = now();
        const info: RemotePolicyResponseInfo = {
          ...requestInput,
          body,
          requestStartedAt,
          response,
          responseBody,
          responseFinishedAt,
          requestMs: responseFinishedAt - requestStartedAt,
        };
        if (remoteEpoch === remoteEpochRef.current) {
          lastRequestMsRef.current = info.requestMs;
          responseCountRef.current += 1;
        }
        cfg.onResponse?.(info);
        const output = await (
          cfg.parseResponse?.(responseBody, info) ??
          defaultParseRemotePolicyResponse(responseBody)
        );
        if (remoteEpoch === remoteEpochRef.current) {
          remoteStatusRef.current = 'ready';
        }
        return output;
      } catch (error) {
        if (response && remoteEpoch === remoteEpochRef.current) {
          lastHttpStatusRef.current = response.status;
        }
        if (isAbortError(error) || signal.aborted) {
          if (remoteEpoch === remoteEpochRef.current) {
            remoteStatusRef.current = 'aborted';
          }
          throw error;
        }
        if (remoteEpoch === remoteEpochRef.current) {
          remoteStatusRef.current = 'error';
        }
        throw error;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
  });

  return useMemo(() => {
    const abort = (reason?: unknown) => {
      abortController(abortControllerRef.current, reason);
      if (abortControllerRef.current) {
        remoteStatusRef.current = 'aborted';
      }
    };
    const resetRemoteState = () => {
      remoteEpochRef.current += 1;
      abort(createAbortError('Remote policy request was reset.'));
      requestCountRef.current = 0;
      responseCountRef.current = 0;
      remoteStatusRef.current = 'idle';
      lastRequestBodyRef.current = null;
      lastResponseBodyRef.current = null;
      lastHttpStatusRef.current = null;
      lastRequestMsRef.current = null;
    };

    return {
      get isRunning() { return policy.isRunning; },
      start: policy.start,
      stop: () => {
        if (configRef.current.abortOnStop ?? true) {
          abort(createAbortError('Remote policy request was stopped.'));
        }
        policy.stop();
        if (configRef.current.clearQueueOnStop) {
          resetRemoteState();
        }
      },
      clearQueue: policy.clearQueue,
      abort,
      reset: () => {
        resetRemoteState();
        policy.reset();
      },
      get inFlight() { return policy.inFlight; },
      get queuedActions() { return policy.queuedActions; },
      get lastObservation() { return policy.lastObservation; },
      get lastAction() { return policy.lastAction; },
      get lastError() { return policy.lastError; },
      get remoteStatus() { return remoteStatusRef.current; },
      get requestCount() { return requestCountRef.current; },
      get responseCount() { return responseCountRef.current; },
      get lastRequestBody() { return lastRequestBodyRef.current; },
      get lastResponseBody() { return lastResponseBodyRef.current; },
      get lastHttpStatus() { return lastHttpStatusRef.current; },
      get lastRequestMs() { return lastRequestMsRef.current; },
    };
  }, [policy]);
}
