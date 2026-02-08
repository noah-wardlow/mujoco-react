/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TrajectoryPlayer — component form of trajectory playback (spec 13.2)
 */

import { useEffect } from 'react';
import { useTrajectoryPlayer } from '../hooks/useTrajectoryPlayer';
import type { TrajectoryPlayerProps } from '../types';

/**
 * Component wrapper for useTrajectoryPlayer.
 * Provides declarative trajectory playback controlled via props.
 */
export function TrajectoryPlayer({
  trajectory,
  fps = 30,
  loop = false,
  playing = false,
  onFrame,
}: TrajectoryPlayerProps) {
  const player = useTrajectoryPlayer(trajectory, { fps, loop });

  useEffect(() => {
    if (playing) {
      player.play();
    } else {
      player.pause();
    }
  }, [playing]);

  useEffect(() => {
    if (onFrame) {
      // Poll frame changes (lightweight, no extra useFrame needed)
      const interval = setInterval(() => {
        if (player.playing) onFrame(player.frame);
      }, 1000 / fps);
      return () => clearInterval(interval);
    }
  }, [onFrame, fps]);

  return null;
}
