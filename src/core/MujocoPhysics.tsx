/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { forwardRef, useEffect } from 'react';
import { useMujocoWasm } from './MujocoProvider';
import { MujocoSimProvider } from './MujocoSimProvider';
import type {
  MujocoSimAPI,
  ReadyCallbackInput,
  SceneConfig,
  SelectionCallbackInput,
  StepCallbackInput,
} from '../types';

export interface MujocoPhysicsProps {
  /** Scene/robot configuration. */
  config: SceneConfig;
  /** Fires when model is loaded and API is ready. */
  onReady?: (input: ReadyCallbackInput) => void;
  /** Fires on scene load failure. */
  onError?: (error: Error) => void;
  /** Called each physics step. */
  onStep?: (input: StepCallbackInput) => void;
  /** Called on body double-click selection. */
  onSelection?: (input: SelectionCallbackInput) => void;
  /** Override model gravity. */
  gravity?: [number, number, number];
  /** Override model.opt.timestep. */
  timestep?: number;
  /** mj_step calls per frame. */
  substeps?: number;
  /** Declarative pause. */
  paused?: boolean;
  /** Simulation speed multiplier. */
  speed?: number;
  /** Interpolate rendered body poses between fixed physics steps. */
  interpolate?: boolean;
  children: React.ReactNode;
}

/**
 * MujocoPhysics — physics provider for use inside a user-owned R3F Canvas.
 *
 * This is the R3F-idiomatic alternative to MujocoCanvas. Instead of wrapping
 * the Canvas, place this inside your own <Canvas>:
 *
 * ```tsx
 * <MujocoProvider>
 *   <Canvas shadows camera={...}>
 *     <MujocoPhysics config={config} paused={paused}>
 *       <SceneRenderer />
 *       <OrbitControls />
 *     </MujocoPhysics>
 *   </Canvas>
 * </MujocoProvider>
 * ```
 *
 * Forward ref exposes MujocoSimAPI.
 */
export const MujocoPhysics = forwardRef<MujocoSimAPI, MujocoPhysicsProps>(
  function MujocoPhysics({ onError, children, ...props }, ref) {
    const { mujoco, status: wasmStatus, error: wasmError } = useMujocoWasm();

    useEffect(() => {
      if (wasmStatus === 'error' && onError) {
        onError(new Error(wasmError ?? 'WASM load failed'));
      }
    }, [wasmStatus, wasmError, onError]);

    if (wasmStatus === 'error' || wasmStatus === 'loading' || !mujoco) {
      return null;
    }

    return (
      <MujocoSimProvider
        mujoco={mujoco}
        apiRef={ref}
        onError={onError}
        {...props}
      >
        {children}
      </MujocoSimProvider>
    );
  }
);
