/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TrajectoryPlayer — component form of trajectory playback (spec 13.2)
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
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
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const lastReportedFrameRef = useRef(-1);

  useEffect(() => {
    if (playing) {
      player.play();
    } else {
      player.pause();
    }
  }, [playing, player]);

  // Use useFrame instead of setInterval to sync with the render loop
  useFrame(() => {
    if (!onFrameRef.current) return;
    const currentFrame = player.frame;
    if (currentFrame !== lastReportedFrameRef.current && player.playing) {
      lastReportedFrameRef.current = currentFrame;
      onFrameRef.current(currentFrame);
    }
  });

  return null;
}
