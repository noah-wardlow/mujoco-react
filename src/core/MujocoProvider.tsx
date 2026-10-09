/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { configureModuleThreads } from './engineState';

import loadMujoco from '@mujoco/mujoco';
import defaultMujocoWasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { MujocoModule, MujocoContextValue } from '../types';

const MujocoContext = createContext<MujocoContextValue>({
  mujoco: null,
  status: 'loading',
  error: null,
});

/**
 * Hook to access the MuJoCo WASM module.
 */
export function useMujocoWasm(): MujocoContextValue {
  return useContext(MujocoContext);
}

export type MujocoWasmVariant = 'single' | 'threaded' | 'auto';

export interface MujocoLoaderOptions {
  locateFile?: (path: string) => string;
  printErr?: (text: string) => void;
}

export type MujocoLoader = (options?: MujocoLoaderOptions) => Promise<unknown>;

export interface MujocoProviderProps {
  wasmUrl?: string;
  /** Optional URL for the multi-threaded WASM asset. */
  mtWasmUrl?: string;
  /**
   * Optional official multi-threaded loader, usually imported from
   * `@mujoco/mujoco/mt`. It is supplied by the app so the default package path
   * does not force every bundler to process the threaded Emscripten build.
   */
  threadedLoader?: MujocoLoader;
  /**
   * MuJoCo WASM build to load. `single` is the default and works everywhere.
   * `threaded` requires `threadedLoader` and cross-origin isolation. `auto`
   * uses threaded only when both conditions are satisfied.
   */
  wasmVariant?: MujocoWasmVariant;
  /** Physics worker count. Requires the threaded build; defaults to 0 (no pool). */
  threadCount?: number;
  /** Timeout in ms for WASM module load. Default: 30000. */
  timeout?: number;
  children: React.ReactNode;
  onError?: (error: Error) => void;
}

function canUseThreadedWasm(): boolean {
  return typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === true;
}

function isMujocoModule(value: unknown): value is MujocoModule {
  return typeof value === 'object'
    && value !== null
    && 'FS' in value
    && 'MjModel' in value
    && 'MjData' in value
    && 'mj_step' in value;
}

function hasWasmUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function resolveWasmVariant(
  variant: MujocoWasmVariant | undefined,
  threadedLoader: MujocoLoader | undefined,
  mtWasmUrl: string | undefined
): 'single' | 'threaded' {
  if (variant === 'threaded') return 'threaded';
  if (variant === 'auto' && threadedLoader && mtWasmUrl && canUseThreadedWasm()) return 'threaded';
  return 'single';
}

/**
 * MujocoProvider — WASM / module lifecycle.
 * Loads the MuJoCo WASM module on mount and provides it to children via context.
 */
export function MujocoProvider({
  wasmUrl,
  mtWasmUrl,
  threadedLoader,
  wasmVariant = 'single',
  threadCount = 0,
  timeout = 30000,
  children,
  onError,
}: MujocoProviderProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const moduleRef = useRef<MujocoModule | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let disposed = false;
    moduleRef.current = null;
    setStatus('loading');
    setError(null);

    const variant = resolveWasmVariant(wasmVariant, threadedLoader, mtWasmUrl);
    if (!Number.isInteger(threadCount) || threadCount < 0 || (threadCount > 0 && variant !== 'threaded') || (variant === 'threaded' && !canUseThreadedWasm())) {
      const err = new Error('threadCount must be a nonnegative integer; threaded physics requires the MT loader and cross-origin isolation');
      setError(err.message); setStatus('error'); onErrorRef.current?.(err); return;
    }
    if (variant === 'threaded' && !threadedLoader) {
      const err = new Error('MujocoProvider wasmVariant="threaded" requires a threadedLoader from @mujoco/mujoco/mt');
      setError(err.message);
      setStatus('error');
      onErrorRef.current?.(err);
      return;
    }
    let selectedWasmUrl = wasmUrl ?? defaultMujocoWasmUrl;

    if (variant === 'threaded') {
      if (!hasWasmUrl(mtWasmUrl)) {
        const err = new Error('MujocoProvider wasmVariant="threaded" requires mtWasmUrl from @mujoco/mujoco/mt/mujoco.wasm?url');
        setError(err.message);
        setStatus('error');
        onErrorRef.current?.(err);
        return;
      }
      selectedWasmUrl = mtWasmUrl;
    }

    const load: MujocoLoader = variant === 'threaded' && threadedLoader ? threadedLoader : loadMujoco;

    const wasmPromise = load({
      locateFile: (path: string) => path.endsWith('.wasm') ? selectedWasmUrl : path,
      printErr: (text: string) => {
        if (text.includes('Aborted') && !disposed) {
          setError('Simulation crashed. Reload page.');
          setStatus('error');
        }
      },
    });

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) =>
      timeoutId = setTimeout(() => reject(new Error(`WASM module load timed out after ${timeout}ms`)), timeout)
    );

    Promise.race([wasmPromise, timeoutPromise])
      .then((inst: unknown) => {
        if (!disposed) {
          if (!isMujocoModule(inst)) {
            throw new Error('MuJoCo WASM module initialized with an unexpected shape');
          }
          configureModuleThreads(inst, threadCount);
          moduleRef.current = inst;
          setStatus('ready');
        }
      })
      .catch((err: Error) => {
        if (!disposed) {
          const msg = err.message || 'Failed to init spatial simulation';
          setError(msg);
          setStatus('error');
          onErrorRef.current?.(new Error(msg));
        }
      }).finally(() => clearTimeout(timeoutId));

    return () => {
      disposed = true;
      clearTimeout(timeoutId);
    };
  }, [wasmUrl, mtWasmUrl, threadedLoader, wasmVariant, threadCount, timeout]);

  return (
    <MujocoContext.Provider
      value={{ mujoco: moduleRef.current, status, error }}
    >
      {children}
    </MujocoContext.Provider>
  );
}
