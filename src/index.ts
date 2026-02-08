/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Core
export { MujocoProvider, useMujoco } from './core/MujocoProvider';
export { MujocoCanvas } from './core/MujocoCanvas';
export { MujocoSimProvider, useMujocoSim, useBeforePhysicsStep, useAfterPhysicsStep } from './core/MujocoSimProvider';
export {
  loadScene,
  getName,
  findSiteByName,
  findActuatorByName,
  findKeyframeByName,
  findBodyByName,
  findJointByName,
  findGeomByName,
  findSensorByName,
  findTendonByName,
} from './core/SceneLoader';

// Components
export { SceneRenderer } from './components/SceneRenderer';
export { IkGizmo } from './components/IkGizmo';
export { ContactMarkers } from './components/ContactMarkers';
export { DragInteraction } from './components/DragInteraction';
export { SceneLights } from './components/SceneLights';
export { Debug } from './components/Debug';
export { TendonRenderer } from './components/TendonRenderer';
export { FlexRenderer } from './components/FlexRenderer';
export { ContactListener } from './components/ContactListener';
export { TrajectoryPlayer } from './components/TrajectoryPlayer';
export { SelectionHighlight } from './components/SelectionHighlight';

// Hooks
export { useActuators } from './hooks/useActuators';
export { useSitePosition } from './hooks/useSitePosition';
export { useGravityCompensation } from './hooks/useGravityCompensation';
export { useSensor, useSensors } from './hooks/useSensor';
export { useJointState } from './hooks/useJointState';
export { useBodyState } from './hooks/useBodyState';
export { useCtrl } from './hooks/useCtrl';
export { useContacts, useContactEvents } from './hooks/useContacts';
export { useKeyboardTeleop } from './hooks/useKeyboardTeleop';
export { usePolicy } from './hooks/usePolicy';
export { useTrajectoryPlayer } from './hooks/useTrajectoryPlayer';
export { useTrajectoryRecorder } from './hooks/useTrajectoryRecorder';
export { useGamepad } from './hooks/useGamepad';
export { useVideoRecorder } from './hooks/useVideoRecorder';
export { useCtrlNoise } from './hooks/useCtrlNoise';

// Types
export type {
  // Scene config
  SceneConfig,
  SceneObject,
  XmlPatch,
  SceneMarker,
  PhysicsConfig,
  // IK
  IKSolveFn,
  // Callbacks
  PhysicsStepCallback,
  // State management
  StateSnapshot,
  // Model introspection
  BodyInfo,
  JointInfo,
  GeomInfo,
  SiteInfo,
  ActuatorInfo,
  SensorInfo,
  // Contacts
  ContactInfo,
  // Raycast
  RayHit,
  // Model options
  ModelOptions,
  // Trajectory
  TrajectoryFrame,
  TrajectoryData,
  // Keyboard teleop
  KeyBinding,
  KeyboardTeleopConfig,
  // Policy
  PolicyConfig,
  // Component props
  IkGizmoProps,
  DragInteractionProps,
  DebugProps,
  SceneLightsProps,
  TrajectoryPlayerProps,
  SelectionHighlightProps,
  ContactListenerProps,
  // API
  MujocoSimAPI,
  MujocoCanvasProps,
  MujocoContextValue,
  // Hook return types
  SitePositionResult,
  SensorResult,
  BodyStateResult,
  JointStateResult,
} from './types';

// Re-export MuJoCo types for convenience
export type { MujocoModule, MujocoModel, MujocoData } from './types';
