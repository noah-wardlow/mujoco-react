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
  speed = 1.0,
  loop = false,
  playing = false,
  mode = 'kinematic',
  onFrame,
  onComplete,
  onStateChange,
}: TrajectoryPlayerProps) {
  const player = useTrajectoryPlayer(trajectory, {
    fps,
    speed,
    loop,
    mode,
    onComplete,
    onStateChange,
  });
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const lastReportedFrameRef = useRef(-1);

  useEffect(() => {
    player.setSpeed(speed);
  }, [speed, player]);

  useEffect(() => {
    if (playing) {
      player.play();
    } else {
      player.pause();
    }
  }, [playing, player]);

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
