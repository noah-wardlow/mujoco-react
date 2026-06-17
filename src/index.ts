/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Core
export { MujocoProvider, useMujocoWasm } from './core/MujocoProvider';
export type { MujocoLoader, MujocoLoaderOptions, MujocoProviderProps, MujocoWasmVariant } from './core/MujocoProvider';
export { MujocoCanvas } from './core/MujocoCanvas';
export { MujocoPhysics } from './core/MujocoPhysics';
export type { MujocoPhysicsProps } from './core/MujocoPhysics';
export { MujocoSimProvider, useMujoco, useBeforePhysicsStep, useAfterPhysicsStep } from './core/MujocoSimProvider';
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
  getActuatedJoints,
  getControlMap,
  resolveControlGroup,
  createContiguousControlGroup,
} from './core/SceneLoader';
export { buildObservation } from './core/ObservationBuilder';

// Controller factory
export { createController, createControllerHook } from './core/createController';
export type { ControllerOptions, ControllerComponent } from './core/createController';

// IK controller hook
export { useIkController } from './hooks/useIkController';

// Components
export { Body } from './components/Body';
export { IkGizmo } from './components/IkGizmo';
export { ContactMarkers } from './components/ContactMarkers';
export { DragInteraction } from './components/DragInteraction';
export { SceneLights } from './components/SceneLights';
export {
  ScenarioLighting,
  SplatEnvironment,
  VisualScenarioEffects,
  createPairedSplatEnvironment,
  createSparkSplatViewerUrl,
  createSplatEnvironmentUserData,
  createSplatSceneConfig,
  createVisualScenarioExecutionContext,
  getSplatEnvironmentReadiness,
  getScenarioBackground,
  getScenarioCameraPosition,
  useSplatEnvironment,
  useSplatSceneConfig,
  useVisualScenarioExecutionContext,
  useVisualScenarioEffects,
  withSplatEnvironment,
} from './components/VisualScenario';
export {
  canFetchSplatCollisionProxyXml,
  fetchSplatCollisionProxyXml,
  parseSplatCollisionProxyGeoms,
  SplatCollisionProxyPreview,
  useSplatCollisionProxyGeoms,
} from './components/SplatCollisionProxyPreview';
export type {
  SplatCollisionProxyGeomPreview,
  SplatCollisionProxyGeomsState,
  SplatCollisionProxyPreviewProps,
  SplatCollisionProxyPreviewStatus,
  SplatCollisionProxyPreviewVector3,
  UseSplatCollisionProxyGeomsOptions,
} from './components/SplatCollisionProxyPreview';
export { Debug } from './components/Debug';
export { TendonRenderer } from './components/TendonRenderer';
export { FlexRenderer } from './components/FlexRenderer';
export { InstancedGeomRenderer } from './components/InstancedGeomRenderer';
export { ContactListener } from './components/ContactListener';
export { TrajectoryPlayer } from './components/TrajectoryPlayer';

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
export { useObservation } from './hooks/useObservation';
export { useTrajectoryPlayer } from './hooks/useTrajectoryPlayer';
export { useTrajectoryRecorder } from './hooks/useTrajectoryRecorder';
export { useGamepad } from './hooks/useGamepad';
export { useVideoRecorder } from './hooks/useVideoRecorder';
export {
  captureFrame,
  captureFrameBlob,
  useFrameCapture,
} from './hooks/useFrameCapture';
export { useCameraFrameCapture } from './hooks/useCameraFrameCapture';
export { useCameraSequenceRecorder } from './hooks/useCameraSequenceRecorder';
export { useMountedCameraSequenceRecorder } from './hooks/useMountedCameraSequenceRecorder';
export type {
  MountedCameraSequencePlanOptions,
  MountedCameraSequenceRecorderAPI,
  MountedCameraSequenceReadiness,
  MountedCameraSequenceRecordOptions,
  MountedCameraSequenceRecordResult,
} from './hooks/useMountedCameraSequenceRecorder';
export {
  captureCameraFrame,
  captureCameraFrameBlob,
  createCameraFrameCaptureSession,
  renderCameraFrameToCanvas,
} from './rendering/cameraFrameCapture';
export {
  createMountedCameraFrameSequenceManifest,
  createMountedCameraFrameSequenceReadiness,
  createMountedCameraFrameSourceSuggestions,
  MountedCameraFrameSequenceManifestStatus,
  MountedCameraFrameSequenceReadinessStatus,
  MountedCameraFrameSourceSuggestionMatch,
  createMountedCameraFrameSequencePlanFromApi,
  createMountedCameraFrameSequencePlan,
  getCameraFrameCaptureSourceTarget,
  getMountedCameraFrameCaptureSource,
  isMountedCameraFrameCaptureSource,
  recordMountedCameraFrameSequence,
  resolveMountedCameraFrameSource,
} from './rendering/cameraFrameSource';
export type {
  CameraFrameMountSelector,
  CreateMountedCameraFrameSequenceManifestOptions,
  CreateMountedCameraFrameSequencePlanOptions,
  MountedCameraFrameCaptureSource,
  MountedCameraFrameSequenceManifest,
  MountedCameraFrameSequencePlanOptions,
  MountedCameraFrameSequenceRecorderTarget,
  MountedCameraFrameSequenceCameraOptions,
  MountedCameraFrameSequenceDefaults,
  MountedCameraFrameSequencePlan,
  MountedCameraFrameSequenceReadiness,
  MountedCameraFrameSequenceRecordOptions,
  MountedCameraFrameSequenceRecordResult,
  MountedCameraFrameSequenceSourceReadiness,
  MountedCameraFrameSequenceStreamSummary,
  MountedCameraFrameSourceSuggestion,
  NamedCameraFrameResource,
  ResolveMountedCameraFrameSourceOptions,
  ResolvedMountedCameraFrameSource,
} from './rendering/cameraFrameSource';
export { useCtrlNoise } from './hooks/useCtrlNoise';
export { useBodyMeshes } from './hooks/useBodyMeshes';
export { useSelectionHighlight } from './hooks/useSelectionHighlight';
export { useSceneLights } from './hooks/useSceneLights';
export { useCameraAnimation } from './hooks/useCameraAnimation';
export type { CameraAnimationAPI } from './hooks/useCameraAnimation';

// Types
export type {
  // Scene config
  SceneConfig,
  SceneObject,
  XmlPatch,
  SceneMarker,
  PhysicsConfig,
  // IK
  IkConfig,
  IkContextValue,
  IKSolveFn,
  IkSolveInput,
  // Callbacks
  PhysicsStepCallback,
  PhysicsStepInput,
  ResetCallbackInput,
  ReadyCallbackInput,
  StepCallbackInput,
  SelectionCallbackInput,
  // State management
  StateSnapshot,
  // Model introspection
  BodyInfo,
  JointInfo,
  ActuatedJointInfo,
  ControlJointInfo,
  ControlGroupInfo,
  ControlGroupSelector,
  ResourceSelector,
  GeomInfo,
  SiteInfo,
  ActuatorInfo,
  SensorInfo,
  CameraInfo,
  // Contacts
  ContactInfo,
  // Raycast
  RayHit,
  // Model options
  ModelOptions,
  // Trajectory
  TrajectoryFrame,
  TrajectoryData,
  TrajectoryInput,
  PlaybackState,
  // Keyboard teleop
  KeyBinding,
  KeyboardTeleopConfig,
  // Policy
  PolicyConfig,
  PolicyVector,
  PolicyObservationInput,
  PolicyInferenceInput,
  PolicyActionInput,
  // Observations
  ObservationConfig,
  ObservationHandle,
  ObservationLayoutItem,
  ObservationOutput,
  ObservationResult,
  // Component props
  BodyProps,
  IkGizmoProps,
  IkGizmoDragInput,
  DragInteractionProps,
  DebugProps,
  SceneLightsProps,
  ScenarioLightingPreset,
  SplatFormat,
  SplatRendererKind,
  SplatCollisionPrimitive,
  ScenarioCameraConfig,
  SplatAssetConfig,
  SplatScenarioConfig,
  SplatCollisionProxyConfig,
  PairedSplatEnvironmentConfig,
  SplatEnvironmentReadiness,
  SplatEnvironmentMetadataInput,
  SplatEnvironmentMetadata,
  VisualScenarioExecutionContext,
  VisualScenarioExecutionContextInput,
  ResolvedScenarioCameraConfig,
  ResolvedScenarioMaterialConfig,
  SplatSceneConfigInput,
  SplatSceneConfigState,
  SplatSceneInput,
  VisualScenarioConfig,
  ScenarioLightingProps,
  ScenarioMaterialConfig,
  SplatEnvironmentProps,
  VisualScenarioEffectsProps,
  VisualScenarioMaterialFilterInput,
  TrajectoryPlayerProps,
  TrajectoryFrameCallbackInput,
  TrajectoryStateChangeInput,
  ContactListenerProps,
  // API
  MujocoSimAPI,
  MujocoFrameCaptureOptions,
  CameraFrameCaptureAPI,
  CameraFrameCaptureBlobResult,
  CameraFrameCaptureOptions,
  CameraFrameCaptureQuaternion,
  CameraFrameCaptureResult,
  CameraFrameCaptureSource,
  CameraFrameCaptureVector3,
  CameraFrameSequenceCamera,
  CameraFrameSequenceCameraSummary,
  CameraFrameSequenceFrame,
  CameraFrameSequenceOptions,
  CameraFrameSequenceRecorderAPI,
  CameraFrameSequenceResult,
  CameraFrameSequenceSampleInput,
  CameraFrameSequenceStepInput,
  MujocoCanvasProps,
  MujocoContextValue,
  // Hook return types
  FrameCaptureAPI,
  FrameCaptureBlobResult,
  FrameCaptureOptions,
  FrameCaptureResult,
  FrameCaptureStatus,
  FrameCaptureTarget,
  FrameCaptureTargetRef,
  SitePositionResult,
  SensorResult,
  CtrlHandle,
  SensorHandle,
  BodyStateResult,
  JointStateResult,
  // Register (type-safe named resources)
  Register,
  RegisteredRobotMap,
  RobotResource,
  Robots,
  Actuators,
  Sensors,
  Bodies,
  Joints,
  Sites,
  Geoms,
  Keyframes,
  Cameras,
} from './types';

export {
  registerRobotResources,
  RobotResources,
  RobotActuators,
  RobotSensors,
  RobotBodies,
  RobotJoints,
  RobotSites,
  RobotGeoms,
  RobotKeyframes,
  RobotCameras,
  SplatEnvironmentReadinessStatus,
} from './types';

// Re-export MuJoCo types for convenience
export type { MujocoModule, MujocoModel, MujocoData, MujocoContact, MujocoContactArray } from './types';
export { getContact } from './types';
