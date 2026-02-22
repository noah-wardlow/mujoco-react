# mujoco-react

Composable [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) wrapper around [mujoco-js](https://github.com/nicepkg/mujoco-js). Load any MuJoCo model, step physics, render bodies, and write controllers as React components.


## Install

```bash
npm install mujoco-react three @react-three/fiber @react-three/drei
```

## Quick Start

```tsx
import {
  MujocoProvider,
  MujocoCanvas,
  SceneRenderer,
  IkController,
  IkGizmo,
} from 'mujoco-react';
import type { SceneConfig, MujocoSimAPI } from 'mujoco-react';
import { OrbitControls } from '@react-three/drei';

const config: SceneConfig = {
  robotId: 'franka_emika_panda',
  sceneFile: 'scene.xml',
  homeJoints: [1.707, -1.754, 0.003, -2.702, 0.003, 0.951, 2.490],
};

function App() {
  const apiRef = useRef<MujocoSimAPI>(null);

  return (
    <MujocoProvider>
      <MujocoCanvas
        ref={apiRef}
        config={config}
        camera={{ position: [2, -1.5, 2.5], up: [0, 0, 1], fov: 45 }}
        shadows
        style={{ width: '100%', height: '100vh' }}
      >
        <OrbitControls enableDamping makeDefault />
        <SceneRenderer />
        <IkController config={{ siteName: 'tcp', numJoints: 7 }}>
          <IkGizmo />
        </IkController>
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 2, 5]} intensity={1.2} castShadow />
      </MujocoCanvas>
    </MujocoProvider>
  );
}
```

## Architecture

Two ways to set up your scene:

### `<MujocoCanvas>`

Wraps R3F `<Canvas>` for you:

```
<MujocoProvider>              <- WASM module lifecycle
  <MujocoCanvas config={...}> <- R3F Canvas + physics context
    <SceneRenderer />          <- Syncs MuJoCo bodies to Three.js meshes
    <IkController config={..}> <- Opt-in controller plugin
      <IkGizmo />
    </IkController>
    <YourController />         <- Bring your own controller
    <YourLights />             <- You compose your own scene
  </MujocoCanvas>
</MujocoProvider>
```

### `<MujocoPhysics>`

Use inside your own `<Canvas>` for control over gl settings, post-processing, etc:

```
<MujocoProvider>
  <Canvas shadows camera={...} gl={...}>   <- Your Canvas, your settings
    <MujocoPhysics config={config}>         <- Physics context only
      <SceneRenderer />
      <YourController />
    </MujocoPhysics>
    <OrbitControls />
    <EffectComposer>...</EffectComposer>    <- Post-processing, etc.
  </Canvas>
</MujocoProvider>
```

The library handles WASM lifecycle, physics stepping, and body rendering. Controllers (IK, teleoperation, RL policies) are composable plugins you opt into or write yourself.

## Bring Your Own Controller

A controller is a React component that calls `useBeforePhysicsStep` to write `data.ctrl` each frame and returns `null`.

```tsx
import { useBeforePhysicsStep } from 'mujoco-react';

function MyController() {
  useBeforePhysicsStep((_model, data) => {
    data.ctrl[0] = Math.sin(data.time);        // sine wave on actuator 0
    data.ctrl[1] = data.sensordata[0] * -0.5;  // feedback from a sensor
  });
  return null;
}

// Drop it in:
<MujocoCanvas config={config}>
  <SceneRenderer />
  <MyController />
</MujocoCanvas>
```

IK, teleoperation, RL policies, state machines all follow this same pattern.

### Bring Your Own IK

The built-in `<IkController>` uses a Damped Least-Squares solver. You can replace it with your own (analytical, learned, etc.):

```tsx
import type { IKSolveFn } from 'mujoco-react';

const myIK: IKSolveFn = (pos, quat, currentQ) => {
  return myAnalyticalSolver(pos, currentQ); // return joint angles or null
};

<IkController config={{ siteName: 'tcp', numJoints: 7, ikSolveFn: myIK }}>
  <IkGizmo />
</IkController>
```

Or skip `<IkController>` entirely and solve IK yourself inside `useBeforePhysicsStep`:

```tsx
function MyIKController() {
  useBeforePhysicsStep((model, data) => {
    const joints = myCustomIKSolve(model, data);
    if (joints) {
      for (let i = 0; i < joints.length; i++) data.ctrl[i] = joints[i];
    }
  });
  return null;
}
```

### `createController<TConfig>()` Factory

For reusable controller plugins with typed config and default merging:

```tsx
import { createController, useBeforePhysicsStep } from 'mujoco-react';

interface MyConfig {
  gain: number;
  targetJoint: string;
}

function MyControllerImpl({ config }: { config: MyConfig; children?: React.ReactNode }) {
  useBeforePhysicsStep((_model, data) => {
    data.ctrl[0] = config.gain * Math.sin(data.time);
  });
  return null;
}

export const MyController = createController<MyConfig>(
  { name: 'MyController', defaultConfig: { gain: 1.0 } },
  MyControllerImpl,
);

// Usage: <MyController config={{ gain: 2.0, targetJoint: 'shoulder' }} />
```

### Built-in `<IkController>`

The library includes one controller for interactive end-effector control:

```tsx
<IkController config={{ siteName: 'tcp', numJoints: 7 }}>
  <IkGizmo />
</IkController>
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `siteName` | `string` | **required** | MuJoCo site to track |
| `numJoints` | `number` | **required** | Number of joints for IK |
| `ikSolveFn` | `IKSolveFn` | built-in DLS | Custom solver function |
| `damping` | `number` | `0.01` | DLS damping |
| `maxIterations` | `number` | `50` | Max solver iterations |

Access IK state from inside `<IkController>` with `useIk()`:

```tsx
const { setIkEnabled, moveTarget, solveIK } = useIk();
```

Pass `{ optional: true }` for components that may or may not be inside an `<IkController>`:

```tsx
const ikCtx = useIk({ optional: true });
```

## Loading Models

Models are loaded from any HTTP source via `SceneConfig.baseUrl`. Defaults to [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie) on GitHub.

```tsx
// Menagerie robots: just set robotId
const franka: SceneConfig = {
  robotId: 'franka_emika_panda',
  sceneFile: 'scene.xml',
};

// Any GitHub repo
const so101: SceneConfig = {
  robotId: 'so101',
  sceneFile: 'SO101.xml',
  baseUrl: 'https://raw.githubusercontent.com/your-org/your-repo/main/models/',
};

// Self-hosted
const custom: SceneConfig = {
  robotId: 'my_robot',
  sceneFile: 'robot.xml',
  baseUrl: 'http://localhost:3000/models/my_robot/',
};
```

The loader fetches the scene XML, parses it for dependencies (meshes, textures, includes), recursively fetches those too, applies any XML patches, and writes everything to MuJoCo's in-memory WASM filesystem.

## SceneConfig

```ts
interface SceneConfig {
  robotId: string;                  // e.g. 'franka_emika_panda'
  sceneFile: string;                // Entry XML file, e.g. 'scene.xml'
  baseUrl?: string;                 // Base URL for fetching model files
  sceneObjects?: SceneObject[];     // Objects injected into scene XML at load time
  homeJoints?: number[];            // Initial joint positions
  xmlPatches?: XmlPatch[];          // Patches applied to XML files during loading
  onReset?: (model, data) => void;  // Called during reset after mj_resetData
}
```

### Adding Objects to Any Scene

```tsx
const config: SceneConfig = {
  robotId: 'franka_emika_panda',
  sceneFile: 'scene.xml',
  sceneObjects: [
    { name: 'ball', type: 'sphere', size: [0.03, 0.03, 0.03],
      position: [0.5, 0, 0.1], rgba: [1, 0, 0, 1], mass: 0.1, freejoint: true },
    { name: 'platform', type: 'box', size: [0.2, 0.2, 0.01],
      position: [0.4, 0.3, 0], rgba: [0.5, 0.5, 0.5, 1] },
  ],
};
```

### XML Patching

```tsx
xmlPatches: [{
  target: 'panda.xml',
  replace: ['name="actuator8"', 'name="gripper"'],
  inject: '<site name="tcp" pos="0 0 0.1" size="0.01"/>',
  injectAfter: '<body name="hand"',
}]
```

## Components

### `<MujocoProvider>`

Loads the MuJoCo WASM module. Wrap your entire app in this.

| Prop | Type | Description |
|------|------|-------------|
| `wasmUrl` | `string?` | Custom WASM URL override |
| `onError` | `(error: Error) => void` | Called if WASM fails to load |

### `<MujocoCanvas>`

Thin wrapper around R3F `<Canvas>`. Accepts all R3F Canvas props plus:

| Prop | Type | Description |
|------|------|-------------|
| `config` | `SceneConfig` | **Required.** Scene/robot configuration |
| `onReady` | `(api: MujocoSimAPI) => void` | Fires when model is loaded |
| `onError` | `(error: Error) => void` | Fires on scene load failure |
| `onStep` | `(time: number) => void` | Called each physics step |
| `onSelection` | `(bodyId: number, name: string) => void` | Called on double-click |
| `gravity` | `[number, number, number]` | Override model gravity |
| `timestep` | `number` | Override model.opt.timestep |
| `substeps` | `number` | mj_step calls per frame |
| `paused` | `boolean` | Declarative pause |
| `speed` | `number` | Simulation speed multiplier |

### `<MujocoPhysics>`

Physics provider for use inside your own R3F `<Canvas>`. Same physics props as `<MujocoCanvas>` without the Canvas wrapper. Accepts a `ref` for the `MujocoSimAPI`.

```tsx
<MujocoProvider>
  <Canvas shadows camera={{ position: [2, 2, 2] }}>
    <MujocoPhysics ref={apiRef} config={config} paused={paused}>
      <SceneRenderer />
      <MyController />
    </MujocoPhysics>
    <OrbitControls />
  </Canvas>
</MujocoProvider>
```

| Prop | Type | Description |
|------|------|-------------|
| `config` | `SceneConfig` | **Required.** Scene/robot configuration |
| `onReady` | `(api: MujocoSimAPI) => void` | Fires when model is loaded |
| `onError` | `(error: Error) => void` | Fires on scene load failure |
| `onStep` | `(time: number) => void` | Called each physics step |
| `onSelection` | `(bodyId: number, name: string) => void` | Called on double-click |
| `gravity` | `[number, number, number]` | Override model gravity |
| `timestep` | `number` | Override model.opt.timestep |
| `substeps` | `number` | mj_step calls per frame |
| `paused` | `boolean` | Declarative pause |
| `speed` | `number` | Simulation speed multiplier |

### `<SceneRenderer />`

Syncs MuJoCo bodies to Three.js meshes every frame. Must be inside `<MujocoCanvas>` or `<MujocoPhysics>`.

### `<IkGizmo />`

drei PivotControls gizmo that tracks a MuJoCo site and drives IK on drag. Must be inside `<IkController>`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `siteName` | `string?` | IkController's site | MuJoCo site to track |
| `scale` | `number?` | `0.18` | Gizmo handle scale |
| `onDrag` | `(pos, quat) => void` | -- | Custom drag handler (disables auto-IK) |

### `<DragInteraction />`

Click-drag to apply spring forces to bodies. Raycasts to find bodies, applies `F = (mouseWorld - grabWorld) * body_mass * stiffness` via `mj_applyFT`.

### R3F Group Props

All visual components (`SceneRenderer`, `DragInteraction`, `ContactMarkers`, `Debug`, `TendonRenderer`, `FlexRenderer`) accept standard R3F group props like `position`, `rotation`, `scale`, `visible`.

```tsx
<SceneRenderer position={[0, 0, 1]} />
<ContactMarkers visible={showContacts} />
<Debug showJoints scale={0.5} />
```

### `<ContactMarkers />`

InstancedMesh showing MuJoCo contact points for debugging.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `maxContacts` | `number?` | `100` | Max contacts to display |
| `radius` | `number?` | `0.005` | Marker sphere radius |
| `color` | `string?` | `'#4f46e5'` | Marker color |
| `visible` | `boolean?` | `true` | Toggle visibility |

### `<SceneLights />`

Auto-creates Three.js lights from MJCF `<light>` elements. Also available as `useSceneLights(intensity?)` hook.

### `<Debug />`

Visualization overlays:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `showGeoms` | `boolean?` | `false` | Wireframe collision geoms |
| `showSites` | `boolean?` | `false` | Site markers |
| `showJoints` | `boolean?` | `false` | Joint axes |
| `showContacts` | `boolean?` | `false` | Contact force vectors |
| `showCOM` | `boolean?` | `false` | Center of mass markers |
| `showInertia` | `boolean?` | `false` | Inertia ellipsoids |
| `showTendons` | `boolean?` | `false` | Tendon paths |
| `geomColor` | `string?` | `'#00ff00'` | Color for wireframe geoms |
| `siteColor` | `string?` | `'#ff00ff'` | Color for site markers |
| `contactColor` | `string?` | `'#ff4444'` | Color for contact force arrows |
| `comColor` | `string?` | `'#ff0000'` | Color for COM markers |

### `<TendonRenderer />`

Renders tendons as tube geometry from wrap paths.

### `<FlexRenderer />`

Renders deformable flex bodies from `flexvert_xpos`.

### `<ContactListener />`

Component wrapper for contact events:

```tsx
<ContactListener
  body="block_1"
  onContactEnter={(info) => console.log('contact!', info)}
  onContactExit={(info) => console.log('released', info)}
/>
```

### `<SelectionHighlight />`

Emissive highlight on selected body meshes. Also available as `useSelectionHighlight(bodyId, options?)` hook.

### `<TrajectoryPlayer />`

Plays back recorded qpos trajectories with scrubbing.

## Hooks

### `useMujocoSim()`

Access the simulation API and internal refs:

```tsx
const { api, mjModelRef, mjDataRef } = useMujocoSim();
```

### `useBeforePhysicsStep(callback)`

Run logic **before** `mj_step` each frame. Write to `data.ctrl`, apply forces, drive automation.

```tsx
useBeforePhysicsStep((model, data) => {
  data.ctrl[0] = Math.sin(data.time);
});
```

### `useAfterPhysicsStep(callback)`

Run logic **after** `mj_step` each frame. Read results, compute rewards, log telemetry.

### `useIk()` / `useIk({ optional: true })`

Access IK controller state. `useIk()` throws if not inside `<IkController>`. Pass `{ optional: true }` to get `null` instead.

### `useCameraAnimation()`

Standalone camera animation hook:

```tsx
const { getCameraState, moveCameraTo } = useCameraAnimation();

// Animate camera over 1 second
await moveCameraTo(
  new THREE.Vector3(3, 0, 2),
  new THREE.Vector3(0, 0, 0.5),
  1000
);
```

### `useSensor(name)` / `useSensors()`

Read sensor values by name (ref-based, no re-renders):

```tsx
const { value, size, type } = useSensor('force_sensor_1');
```

### `useBodyState(name)`

Position, quaternion, linear/angular velocity of a body (ref-based):

```tsx
const { position, quaternion, linearVelocity, angularVelocity } = useBodyState('block_1');
```

### `useJointState(name)`

Joint position and velocity:

```tsx
const { position, velocity } = useJointState('joint1');
```

### `useCtrl(name)`

Read/write actuator control by name:

```tsx
const [value, setValue] = useCtrl('gripper');
```

### `useContacts(bodyName?)` / `useContactEvents(bodyName, handlers)`

Query contacts or subscribe to enter/exit events:

```tsx
useContactEvents('block_1', {
  onEnter: (info) => console.log('contact!', info),
  onExit: (info) => console.log('released', info),
});
```

### `useKeyboardTeleop(config)`

Map keyboard keys to actuators:

```tsx
useKeyboardTeleop({
  bindings: {
    'w': { actuator: 'forward', delta: 0.1 },
    's': { actuator: 'forward', delta: -0.1 },
    'v': { actuator: 'gripper', toggle: [0, 0.04] },
  },
});
```

### `useGamepad(config)`

Map gamepad axes/buttons to actuators:

```tsx
useGamepad({
  axes: { 0: 'joint1', 1: 'joint2' },
  buttons: { 0: 'gripper' },
  deadzone: 0.1,
});
```

### `usePolicy(config)`

Framework-agnostic decimation loop for RL policies:

```tsx
const { step, isRunning } = usePolicy({
  frequency: 50,
  onObservation: (model, data) => buildObs(model, data),
  onAction: (action, model, data) => applyAction(action, data),
});
```

### `useTrajectoryRecorder(config)` / `useTrajectoryPlayer(trajectory, config)`

Record and play back simulation trajectories:

```tsx
const recorder = useTrajectoryRecorder({ fields: ['qpos', 'qvel', 'ctrl'] });
// recorder.start(), recorder.stop(), recorder.downloadJSON(), recorder.downloadCSV()

const player = useTrajectoryPlayer(trajectory, { fps: 30, loop: true });
// player.play(), player.pause(), player.seek(frameIdx)
```

### `useVideoRecorder(config)`

Record the canvas as video:

```tsx
const video = useVideoRecorder({ fps: 30, mimeType: 'video/webm' });
// video.start(), video.stop() -> returns Blob
```

### `useCtrlNoise(config)`

Apply Gaussian noise to controls for robustness testing:

```tsx
useCtrlNoise({ rate: 0.01, std: 0.05 });
```

### `useGravityCompensation(enabled?)`

Applies `qfrc_bias` to `qfrc_applied` so joints hold position against gravity.

### `useActuators()`

Returns actuator metadata for building control UIs.

### `useSitePosition(siteName)`

Ref-based site position/quaternion tracking.

### `useSelectionHighlight(bodyId, options?)`

Hook form of `<SelectionHighlight>`. Apply emissive highlights imperatively:

```tsx
useSelectionHighlight(selectedBodyId, { color: '#00ff00', emissiveIntensity: 0.5 });
```

### `useSceneLights(intensity?)`

Hook form of `<SceneLights>`. Create Three.js lights from MJCF definitions imperatively:

```tsx
useSceneLights(1.5);
```

## MujocoSimAPI

The full API object available via `ref` or `useMujocoSim().api`:

### Simulation Control

| Method | Description |
|--------|-------------|
| `reset()` | Reset sim, re-apply home joints |
| `setPaused(paused)` | Set pause state |
| `togglePause()` | Toggle pause, returns new state |
| `setSpeed(multiplier)` | Set simulation speed |
| `step(n?)` | Advance exactly n steps while paused |
| `getTime()` | Current simulation time |
| `getTimestep()` | Current timestep |

### State Management

| Method | Description |
|--------|-------------|
| `saveState()` | Snapshot qpos, qvel, ctrl, time, act |
| `restoreState(snapshot)` | Restore from snapshot |
| `setQpos(values)` / `getQpos()` | Direct qpos access |
| `setQvel(values)` / `getQvel()` | Direct qvel access |
| `setCtrl(nameOrValues, value?)` | Set control by name or batch |
| `getCtrl(name?)` | Get control values |
| `applyKeyframe(nameOrIndex)` | Apply a keyframe |
| `getKeyframeNames()` / `getKeyframeCount()` | Keyframe introspection |

### Forces

| Method | Description |
|--------|-------------|
| `applyForce(bodyName, force, point?)` | Apply force via `mj_applyFT` |
| `applyTorque(bodyName, torque)` | Apply torque via `mj_applyFT` |
| `setExternalForce(bodyName, force, torque)` | Write to `xfrc_applied` |
| `applyGeneralizedForce(values)` | Write to `qfrc_applied` |

### Model Introspection

| Method | Description |
|--------|-------------|
| `getBodies()` | All bodies with id, name, mass, parentId |
| `getJoints()` | All joints with id, name, type, range, bodyId |
| `getGeoms()` | All geoms with id, name, type, size, bodyId |
| `getSites()` | All sites with id, name, bodyId |
| `getActuators()` | All actuators with id, name, range |
| `getSensors()` | All sensors with id, name, type, dim |
| `getSensorData(name)` | Read sensor value by name |
| `getContacts()` | All active contacts |
| `getModelOption()` | Timestep, gravity, integrator |

### Model Mutation

| Method | Description |
|--------|-------------|
| `setGravity(g)` | Set gravity vector |
| `setTimestep(dt)` | Set timestep |
| `setBodyMass(name, mass)` | Domain randomization |
| `setGeomFriction(name, friction)` | Domain randomization |
| `setGeomSize(name, size)` | Domain randomization |

### Spatial Queries

| Method | Description |
|--------|-------------|
| `raycast(origin, direction, maxDist?)` | Physics raycast via `mj_ray` |
| `project2DTo3D(x, y, camPos, lookAt)` | Screen-to-world raycast (returns bodyId + geomId) |
| `getCanvasSnapshot(w?, h?, mime?)` | Base64 screenshot |

### Scene Management

| Method | Description |
|--------|-------------|
| `loadScene(newConfig)` | Runtime model swap |

## Guides

### Building Controllers

See [Building Controllers](https://mujoco-react.mintlify.app/guides/building-controllers) for full patterns including config-driven controllers, IK gizmo coexistence, multi-arm support, and the `createController` factory.

### Graspable Objects

Objects need specific MuJoCo contact parameters to be picked up by grippers:

```tsx
sceneObjects: [{
  name: 'cube',
  type: 'box',
  size: [0.025, 0.025, 0.025],
  position: [0.4, 0, 0.025],
  rgba: [0.9, 0.2, 0.15, 1],
  mass: 0.05,
  freejoint: true,
  friction: '1.5 0.3 0.1',            // high sliding friction
  solref: '0.01 1',                    // stiff contact solver
  solimp: '0.95 0.99 0.001 0.5 2',    // tight impedance
  condim: 4,                           // elliptic friction cone
}]
```

Without `condim: 4` and high friction, objects slide out of the gripper when lifted. See [Graspable Objects](https://mujoco-react.mintlify.app/guides/graspable-objects) for details.

### Click-to-Select

Combine R3F raycasting with `<SelectionHighlight />` for body selection:

```tsx
function ClickSelectOverlay() {
  const selectedBodyId = useClickSelect(); // your raycasting hook
  return <SelectionHighlight bodyId={selectedBodyId} />;
}
```

See [Click-to-Select](https://mujoco-react.mintlify.app/guides/click-to-select) for the full implementation.

## useFrame Priority

| Priority | Owner | Purpose |
|----------|-------|---------|
| -1 | MujocoSimProvider | beforeStep, mj_step, afterStep |
| 0 (default) | SceneRenderer, IkController, your code | Body mesh sync, IK, rendering |

## Roadmap

Features planned but not yet implemented:

| Feature | Priority | Description |
|---------|----------|-------------|
| **User-uploaded model loading** | P2 | `loadFromFiles(FileList)` -- detect meshdir, write to VFS |
| **URDF loading** | P2 | Load URDF models via MuJoCo's built-in URDF compiler |
| **XML mutation / recompile** | P1 | `addBody()`, `removeBody()`, `recompile()` for runtime XML editing |
| **Observation builder utilities** | P2 | Helpers for projected gravity, joint positions/velocities for RL |
| **Physics interpolation** | P1 | Smooth rendering between physics ticks for very high refresh displays |
| **Instanced geom rendering** | P2 | `<InstancedGeomRenderer />` for particle/granular sims |
| **Web Worker physics** | P2 | Run `mj_step` off main thread via SharedArrayBuffer |

### WASM Limitations (mujoco-js 0.0.7)

These MuJoCo features are not yet exposed in the WASM binding:

- `flex_faceadr` / `flex_facenum` / `flex_face` -- FlexRenderer renders vertices without face indices
- `ten_rgba` / `ten_width` -- TendonRenderer uses default color/width

## License

Apache-2.0
