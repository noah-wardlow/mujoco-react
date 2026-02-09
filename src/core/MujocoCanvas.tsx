/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Canvas } from '@react-three/fiber';
import { forwardRef, useEffect } from 'react';
import { useMujoco } from './MujocoProvider';
import { MujocoSimProvider } from './MujocoSimProvider';
import { MujocoCanvasProps, MujocoSimAPI } from '../types';

/**
 * MujocoCanvas — thin R3F Canvas wrapper for MuJoCo scenes.
 * Accepts all R3F Canvas props and forwards them through.
 * Supports declarative physics config props (spec 1.1).
 *
 * Forward ref exposes MujocoSimAPI (not the canvas element).
 */
export const MujocoCanvas = forwardRef<MujocoSimAPI, MujocoCanvasProps>(
  function MujocoCanvas(
    {
      config,
      onReady,
      onError,
      onStep,
      onSelection,
      // Declarative physics config (spec 1.1)
      gravity,
      timestep,
      substeps,
      paused,
      speed,
      interpolate,
      gravityCompensation,
      mjcfLights,
      children,
      ...canvasProps
    },
    ref
  ) {
    const { mujoco, status: wasmStatus, error: wasmError } = useMujoco();

    useEffect(() => {
      if (wasmStatus === 'error' && onError) {
        onError(new Error(wasmError ?? 'WASM load failed'));
      }
    }, [wasmStatus, wasmError, onError]);

    if (wasmStatus === 'error' || wasmStatus === 'loading' || !mujoco) {
      return null;
    }

    return (
      <Canvas {...canvasProps}>
        <MujocoSimProvider
          mujoco={mujoco}
          config={config}
          apiRef={ref}
          onReady={onReady}
          onError={onError}
          onStep={onStep}
          onSelection={onSelection}
          gravity={gravity}
          timestep={timestep}
          substeps={substeps}
          paused={paused}
          speed={speed}
          interpolate={interpolate}
        >
          {children}
        </MujocoSimProvider>
      </Canvas>
    );
  }
);
