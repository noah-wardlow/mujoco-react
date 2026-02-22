/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useTrajectoryPlayer — trajectory playback/scrubbing (spec 13.2)
 */

import { useCallback, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useMujocoContext } from '../core/MujocoSimProvider';

interface TrajectoryPlayerOptions {
  fps?: number;
  loop?: boolean;
}

/**
 * Play back a sequence of qpos frames, overriding simulation state.
 *
 * When playing, the simulation is effectively paused and qpos is set
 * from the trajectory each render frame at the specified FPS.
 */
export function useTrajectoryPlayer(
  trajectory: number[][],
  options: TrajectoryPlayerOptions = {},
) {
  const { mjModelRef, mjDataRef, mujocoRef, pausedRef } = useMujocoContext();
  const fps = options.fps ?? 30;
  const loop = options.loop ?? false;

  const playingRef = useRef(false);
  const frameRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  const play = useCallback(() => {
    playingRef.current = true;
    pausedRef.current = true; // Pause sim during playback
    lastFrameTimeRef.current = performance.now();
  }, [pausedRef]);

  const pause = useCallback(() => {
    playingRef.current = false;
  }, []);

  const seek = useCallback((frameIdx: number) => {
    frameRef.current = Math.max(0, Math.min(frameIdx, trajectory.length - 1));
    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data || !trajectory[frameRef.current]) return;
    const qpos = trajectory[frameRef.current];
    for (let i = 0; i < Math.min(qpos.length, model.nq); i++) {
      data.qpos[i] = qpos[i];
    }
    mujocoRef.current.mj_forward(model, data);
  }, [trajectory, mjModelRef, mjDataRef, mujocoRef]);

  const reset = useCallback(() => {
    frameRef.current = 0;
    playingRef.current = false;
    pausedRef.current = false;
  }, [pausedRef]);

  useFrame(() => {
    if (!playingRef.current || trajectory.length === 0) return;

    const now = performance.now();
    const elapsed = now - lastFrameTimeRef.current;
    const frameInterval = 1000 / fps;

    if (elapsed < frameInterval) return;
    lastFrameTimeRef.current = now;

    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    const qpos = trajectory[frameRef.current];
    if (!qpos) return;

    for (let i = 0; i < Math.min(qpos.length, model.nq); i++) {
      data.qpos[i] = qpos[i];
    }
    mujocoRef.current.mj_forward(model, data);

    frameRef.current++;
    if (frameRef.current >= trajectory.length) {
      if (loop) {
        frameRef.current = 0;
      } else {
        playingRef.current = false;
        pausedRef.current = false;
      }
    }
  });

  return {
    play,
    pause,
    seek,
    reset,
    get frame() { return frameRef.current; },
    get playing() { return playingRef.current; },
    get totalFrames() { return trajectory.length; },
  };
}
