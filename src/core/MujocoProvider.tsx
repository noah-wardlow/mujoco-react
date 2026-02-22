/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import loadMujoco from 'mujoco-js';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MujocoModule, MujocoContextValue } from '../types';

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

interface MujocoProviderProps {
  wasmUrl?: string;
  /** Timeout in ms for WASM module load. Default: 30000. */
  timeout?: number;
  children: React.ReactNode;
  onError?: (error: Error) => void;
}

/**
 * MujocoProvider — WASM / module lifecycle.
 * Loads the MuJoCo WASM module on mount and provides it to children via context.
 */
export function MujocoProvider({ wasmUrl, timeout = 30000, children, onError }: MujocoProviderProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const moduleRef = useRef<MujocoModule | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    const wasmPromise = loadMujoco({
      ...(wasmUrl ? { locateFile: (path: string) => path.endsWith('.wasm') ? wasmUrl : path } : {}),
      printErr: (text: string) => {
        if (text.includes('Aborted') && isMounted.current) {
          setError('Simulation crashed. Reload page.');
          setStatus('error');
        }
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`WASM module load timed out after ${timeout}ms`)), timeout)
    );

    Promise.race([wasmPromise, timeoutPromise])
      .then((inst: unknown) => {
        if (isMounted.current) {
          moduleRef.current = inst as MujocoModule;
          setStatus('ready');
        }
      })
      .catch((err: Error) => {
        if (isMounted.current) {
          const msg = err.message || 'Failed to init spatial simulation';
          setError(msg);
          setStatus('error');
          onError?.(new Error(msg));
        }
      });

    return () => {
      isMounted.current = false;
    };
  }, [wasmUrl, timeout]);

  return (
    <MujocoContext.Provider
      value={{ mujoco: moduleRef.current, status, error }}
    >
      {children}
    </MujocoContext.Provider>
  );
}
