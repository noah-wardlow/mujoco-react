/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useTrajectoryPlayer — trajectory playback/scrubbing (spec 13.2)
 */

import { useCallback, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useMujocoContext, useBeforePhysicsStep } from '../core/MujocoSimProvider';
import type { PlaybackState, TrajectoryFrame, TrajectoryInput } from '../types';

export interface TrajectoryPlayerOptions {
  fps?: number;
  speed?: number;
  loop?: boolean;
  mode?: 'kinematic' | 'physics';
  onComplete?: () => void;
  onStateChange?: (state: PlaybackState) => void;
}

/** Check if input is TrajectoryFrame[] (vs number[][]) */
function isTrajectoryFrames(input: TrajectoryInput): input is TrajectoryFrame[] {
  return input.length > 0 && typeof (input[0] as TrajectoryFrame).time === 'number'
    && 'qpos' in (input[0] as TrajectoryFrame);
}

/** Extract qpos as plain number array from a frame */
function getQpos(input: TrajectoryInput, idx: number): ArrayLike<number> | null {
  const item = input[idx];
  if (!item) return null;
  if (Array.isArray(item)) return item;
  return (item as TrajectoryFrame).qpos;
}

/** Extract ctrl values from a TrajectoryFrame, if available */
function getCtrl(input: TrajectoryInput, idx: number): ArrayLike<number> | null {
  const item = input[idx];
  if (!item || Array.isArray(item)) return null;
  return (item as TrajectoryFrame).ctrl ?? null;
}

/**
 * Play back a trajectory, overriding simulation state.
 *
 * Accepts either `TrajectoryFrame[]` (from useTrajectoryRecorder) or
 * `number[][]` (raw qpos arrays).
 *
 * In `kinematic` mode (default), the simulation is paused and qpos is
 * set directly each frame with mj_forward for rendering.
 *
 * In `physics` mode, the simulation keeps running and ctrl values from
 * the trajectory are applied each physics step via useBeforePhysicsStep.
 */
export function useTrajectoryPlayer(
  trajectory: TrajectoryInput,
  options: TrajectoryPlayerOptions = {},
) {
  const { mjModelRef, mjDataRef, mujocoRef, pausedRef } = useMujocoContext();

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stateRef = useRef<PlaybackState>('idle');
  const frameRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const speedRef = useRef(options.speed ?? 1.0);
  const wasPausedRef = useRef(false);

  // Stable ref to trajectory to avoid stale closures in useBeforePhysicsStep
  const trajectoryRef = useRef(trajectory);
  trajectoryRef.current = trajectory;

  const setState = useCallback((next: PlaybackState) => {
    if (stateRef.current === next) return;
    stateRef.current = next;
    optionsRef.current.onStateChange?.(next);
  }, []);

  const play = useCallback(() => {
    const traj = trajectoryRef.current;
    if (traj.length === 0) return;

    const mode = optionsRef.current.mode ?? 'kinematic';

    if (stateRef.current === 'completed') {
      frameRef.current = 0;
    }

    if (mode === 'kinematic') {
      wasPausedRef.current = pausedRef.current;
      pausedRef.current = true;
    }

    lastFrameTimeRef.current = performance.now();
    setState('playing');
  }, [pausedRef, setState]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'playing') return;
    setState('paused');
  }, [setState]);

  const seek = useCallback((frameIdx: number) => {
    const traj = trajectoryRef.current;
    if (traj.length === 0) return;

    frameRef.current = Math.max(0, Math.min(frameIdx, traj.length - 1));

    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    const qpos = getQpos(traj, frameRef.current);
    if (!qpos) return;

    for (let i = 0; i < Math.min(qpos.length, model.nq); i++) {
      data.qpos[i] = qpos[i];
    }
    mujocoRef.current.mj_forward(model, data);
  }, [mjModelRef, mjDataRef, mujocoRef]);

  const reset = useCallback(() => {
    const mode = optionsRef.current.mode ?? 'kinematic';
    if (mode === 'kinematic' && stateRef.current !== 'idle') {
      pausedRef.current = wasPausedRef.current;
    }
    frameRef.current = 0;
    setState('idle');
  }, [pausedRef, setState]);

  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
  }, []);

  const complete = useCallback(() => {
    const mode = optionsRef.current.mode ?? 'kinematic';
    if (mode === 'kinematic') {
      pausedRef.current = wasPausedRef.current;
    }
    setState('completed');
    optionsRef.current.onComplete?.();
  }, [pausedRef, setState]);

  // --- Kinematic mode: drive qpos directly from useFrame ---
  useFrame(() => {
    if (stateRef.current !== 'playing') return;
    if ((optionsRef.current.mode ?? 'kinematic') !== 'kinematic') return;

    const traj = trajectoryRef.current;
    if (traj.length === 0) return;

    const now = performance.now();
    const fps = optionsRef.current.fps ?? 30;
    const frameInterval = 1000 / (fps * speedRef.current);
    const elapsed = now - lastFrameTimeRef.current;

    if (elapsed < frameInterval) return;
    lastFrameTimeRef.current = now;

    const model = mjModelRef.current;
    const data = mjDataRef.current;
    if (!model || !data) return;

    const qpos = getQpos(traj, frameRef.current);
    if (!qpos) return;

    for (let i = 0; i < Math.min(qpos.length, model.nq); i++) {
      data.qpos[i] = qpos[i];
    }
    mujocoRef.current.mj_forward(model, data);

    frameRef.current++;
    if (frameRef.current >= traj.length) {
      if (optionsRef.current.loop) {
        frameRef.current = 0;
      } else {
        complete();
      }
    }
  });

  // --- Physics mode: set ctrl values each physics step ---
  useBeforePhysicsStep((model, data) => {
    if (stateRef.current !== 'playing') return;
    if ((optionsRef.current.mode ?? 'kinematic') !== 'physics') return;

    const traj = trajectoryRef.current;
    if (traj.length === 0) return;

    // Advance frame based on sim time vs trajectory time
    const fps = optionsRef.current.fps ?? 30;
    const targetFrame = Math.floor(data.time * fps * speedRef.current);
    frameRef.current = Math.min(targetFrame, traj.length - 1);

    // Apply ctrl from trajectory
    const ctrl = getCtrl(traj, frameRef.current);
    if (ctrl) {
      for (let i = 0; i < Math.min(ctrl.length, model.nu); i++) {
        data.ctrl[i] = ctrl[i];
      }
    }

    // Check completion
    if (frameRef.current >= traj.length - 1) {
      if (optionsRef.current.loop) {
        // Reset sim time to restart
        data.time = 0;
        frameRef.current = 0;
      } else {
        complete();
      }
    }
  });

  return {
    play,
    pause,
    seek,
    reset,
    setSpeed,
    get state() { return stateRef.current; },
    get frame() { return frameRef.current; },
    get playing() { return stateRef.current === 'playing'; },
    get totalFrames() { return trajectory.length; },
    get progress() { return trajectory.length > 1 ? frameRef.current / (trajectory.length - 1) : 0; },
  };
}
