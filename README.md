<p align="center">
  <img src="docs/images/mj2.gif" alt="mujoco-react demo" width="100%" />
</p>

# mujoco-react

> **Beta** — This library is under active development. The API may change between minor versions until 1.0.

Composable [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) wrapper around [mujoco-js](https://www.npmjs.com/package/mujoco-js). Load any MuJoCo model, step physics, render bodies, and write controllers as React components.

**[Demo](https://mujoco-react-example.pages.dev)** | **[Docs](https://dadd.mintlify.app)** | **[Example Source](https://github.com/noah-wardlow/mujoco-react-example)** | **[llms.txt](https://dadd.mintlify.app/llms.txt)**

## Install

```bash
npm install mujoco-react three @react-three/fiber @react-three/drei
```

## Quick Start

```tsx
import {
  MujocoProvider,
  MujocoCanvas,
  useIkController,
  IkGizmo,
} from "mujoco-react";
import type { SceneConfig } from "mujoco-react";
import { OrbitControls } from "@react-three/drei";

const config: SceneConfig = {
  src: "https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/franka_emika_panda/",
  sceneFile: "scene.xml",
  homeJoints: [1.707, -1.754, 0.003, -2.702, 0.003, 0.951, 2.490],
};

function Scene() {
  const ik = useIkController({ siteName: "tcp", numJoints: 7 });
  return (
    <>
      <OrbitControls enableDamping makeDefault />
      {ik && <IkGizmo controller={ik} />}
      <ambientLight intensity={0.7} />
      <directionalLight position={[1, 2, 5]} intensity={1.2} castShadow />
    </>
  );
}

function App() {
  return (
    <MujocoProvider>
      <MujocoCanvas
        config={config}
        camera={{ position: [2, -1.5, 2.5], up: [0, 0, 1], fov: 45 }}
        shadows
        style={{ width: "100%", height: "100vh" }}
      >
        <Scene />
      </MujocoCanvas>
    </MujocoProvider>
  );
}
```

## `useMujoco()`

Inside `<MujocoCanvas>` or `<MujocoPhysics>`, `useMujoco()` gives you the simulation API, refs to the live model/data, and status:

```tsx
import { useMujoco } from "mujoco-react";

function MyComponent() {
  const { isPending, isError, error, api, mjModelRef } = useMujoco();

  if (isPending) return <span>Loading...</span>;
  if (isError) return <span>Error: {error}</span>;

  return (
    <button onClick={() => api.reset()}>
      Reset ({mjModelRef.current?.nq} joints)
    </button>
  );
}
```

## Writing a Controller

A controller is a React component that uses handle-based hooks for type-safe actuator and sensor access:

```tsx
import { useCtrl, useSensor, useBeforePhysicsStep } from "mujoco-react";

function MyController() {
  const shoulder = useCtrl("shoulder");
  const elbow = useCtrl("elbow");
  const force = useSensor("force_sensor");

  useBeforePhysicsStep(() => {
    shoulder.write(Math.sin(Date.now() / 1000));
    elbow.write(force.read()[0] * -0.5);
  });
  return null;
}
```

Drop it into the tree:

```tsx
<MujocoCanvas config={config}>
  <MyController />
</MujocoCanvas>
```

The `createController<TConfig>()` factory adds typed config and default merging for reusable plugins:

```tsx
import { createController, useBeforePhysicsStep } from "mujoco-react";

export const MyController = createController<{ gain: number }>(
  { name: "MyController", defaultConfig: { gain: 1.0 } },
  ({ config }) => {
    useBeforePhysicsStep((_model, data) => {
      data.ctrl[0] = config.gain * Math.sin(data.time);
    });
    return null;
  },
);

// <MyController config={{ gain: 2.0 }} />
```

## Architecture

`<MujocoCanvas>` wraps R3F `<Canvas>` and forwards all Canvas props (`camera`, `shadows`, `gl`, etc.). For full control over the Canvas, use `<MujocoPhysics>` inside your own:

```
<MujocoProvider>                           <MujocoProvider>
  <MujocoCanvas config={...}>               <Canvas shadows gl={...}>
    <Scene />                                  <MujocoPhysics config={...}>
    <MyController />                             <MyController />
  </MujocoCanvas>                              </MujocoPhysics>
</MujocoProvider>                              <EffectComposer>...</EffectComposer>
                                             </Canvas>
                                           </MujocoProvider>
```

### Custom IK Solvers

The built-in `useIkController()` uses Damped Least-Squares. Pass `ikSolveFn` to swap in your own solver (analytical, learned, etc.):

```tsx
import type { IKSolveFn } from "mujoco-react";

const myIK: IKSolveFn = (pos, quat, currentQ) => {
  return myAnalyticalSolver(pos, currentQ); // return joint angles or null
};

const ik = useIkController({ siteName: "tcp", numJoints: 7, ikSolveFn: myIK });
```

### `useIkController(config | null)`

Hook for interactive end-effector control. Pass `null` to disable IK (safe to call unconditionally):

```tsx
const ik = useIkController({ siteName: "tcp", numJoints: 7 });
return ik ? <IkGizmo controller={ik} /> : null;
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `siteName` | `string` | **required** | MuJoCo site to track |
| `numJoints` | `number` | **required** | Number of joints for IK |
| `ikSolveFn` | `IKSolveFn` | built-in DLS | Custom solver function |
| `damping` | `number` | `0.01` | DLS damping |
| `maxIterations` | `number` | `50` | Max solver iterations |

Returns `IkContextValue | null` with methods like `setIkEnabled`, `moveTarget`, `syncTargetToSite`, `solveIK`, and `getGizmoStats`.

Pass the returned value to `<IkGizmo controller={ik} />` or to your own controller as a prop.

## Type-Safe Resource Names

Use TypeScript module augmentation to get autocomplete and type checking for actuator, sensor, body, joint, site, geom, and keyframe names:

```ts
// e.g. in src/mujoco-register.d.ts
declare module "mujoco-react" {
  interface Register {
    actuators: "joint1" | "joint2" | "joint3" | "gripper";
    sensors: "force_sensor" | "torque_sensor";
    bodies: "link0" | "link1" | "hand";
  }
}
```

Once declared, hooks like `useCtrl`, `useSensor`, `useBodyState`, and API methods like `setCtrl`, `applyForce`, `getSensorData` will only accept the declared names. When no `Register` augmentation is provided, all names fall back to `string`.

## Loading Models

The loader fetches `src + sceneFile`, parses the XML for dependencies (meshes, textures, includes), recursively fetches those too, and writes everything to MuJoCo's in-memory WASM filesystem.

```tsx
// MuJoCo Menagerie
const franka: SceneConfig = {
  src: "https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/franka_emika_panda/",
  sceneFile: "scene.xml",
};

// Any URL
const custom: SceneConfig = {
  src: "http://localhost:3000/models/my_model/",
  sceneFile: "model.xml",
};
```

## SceneConfig

```ts
interface SceneConfig {
  src: string;                      // Base URL for model files
  sceneFile: string;                // Entry XML file, e.g. "scene.xml"
  sceneObjects?: SceneObject[];     // Objects injected into scene XML at load time
  homeJoints?: number[];            // Initial joint positions
  xmlPatches?: XmlPatch[];          // Patches applied to XML files during loading
  onReset?: (model, data) => void;  // Called during reset after mj_resetData
}
```

### Adding Objects to Any Scene

```tsx
const config: SceneConfig = {
  src: "https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/franka_emika_panda/",
  sceneFile: "scene.xml",
  sceneObjects: [
    { name: "ball", type: "sphere", size: [0.03, 0.03, 0.03],
      position: [0.5, 0, 0.1], rgba: [1, 0, 0, 1], mass: 0.1, freejoint: true },
    { name: "platform", type: "box", size: [0.2, 0.2, 0.01],
      position: [0.4, 0.3, 0], rgba: [0.5, 0.5, 0.5, 1] },
  ],
};
```

### XML Patching

```tsx
xmlPatches: [{
  target: "panda.xml",
  replace: ["name=\"actuator8\"", "name=\"gripper\""],
  inject: "<site name=\"tcp\" pos=\"0 0 0.1\" size=\"0.01\"/>",
  injectAfter: "<body name=\"hand\"",
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

### `<Body />`

Declaratively add physics bodies to the simulation as JSX. Bodies are injected into the MJCF XML before model compilation.

```tsx
<Body name="cube" type="box" size={[0.05, 0.05, 0.05]}
      position={[0.5, 0, 0.05]} rgba={[1, 0, 0, 1]}
      mass={0.1} freejoint />

// With custom Three.js visuals
<Body name="ball" type="sphere" size={[0.03, 0, 0]}
      position={[0, 0.3, 0.1]} mass={0.5} freejoint>
  <mesh>
    <sphereGeometry args={[0.03]} />
    <meshPhysicalMaterial color="gold" metalness={0.8} />
  </mesh>
</Body>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | **required** | Unique body name |
| `type` | `'box' \| 'sphere' \| 'cylinder'` | **required** | Geom type |
| `size` | `[number, number, number]` | **required** | Geom size |
| `position` | `[number, number, number]` | `[0,0,0]` | Initial position |
| `rgba` | `[number, number, number, number]` | `[0.5,0.5,0.5,1]` | Color (ignored with children) |
| `mass` | `number?` | -- | Body mass in kg |
| `freejoint` | `boolean?` | -- | Add freejoint for free movement |
| `friction` | `string?` | -- | MuJoCo friction params |
| `condim` | `number?` | -- | Contact dimensionality (4-6 for grasping) |
| `children` | `ReactNode?` | -- | Custom Three.js visuals |

### `<IkGizmo />`

drei PivotControls gizmo that tracks a MuJoCo site and drives IK on drag. Requires a `controller` from `useIkController()`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `controller` | `IkContextValue` | **required** | Controller from `useIkController()` |
| `siteName` | `string?` | controller's site | MuJoCo site to track |
| `scale` | `number?` | `0.18` | Gizmo handle scale |
| `onDrag` | `(pos, quat) => void` | -- | Custom drag handler (disables auto-IK) |

### `<DragInteraction />`

Click-drag to apply spring forces to bodies. Raycasts to find bodies, applies `F = (mouseWorld - grabWorld) * body_mass * stiffness` via `mj_applyFT`.

### R3F Group Props

All visual components (`DragInteraction`, `ContactMarkers`, `Debug`, `TendonRenderer`, `FlexRenderer`) accept standard R3F group props like `position`, `rotation`, `scale`, `visible`.

```tsx
<ContactMarkers visible={showContacts} />
<Debug showJoints scale={0.5} />
```

### `<ContactMarkers />`

InstancedMesh showing MuJoCo contact points for debugging.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `maxContacts` | `number?` | `100` | Max contacts to display |
| `radius` | `number?` | `0.005` | Marker sphere radius |
| `color` | `string?` | `"#4f46e5"` | Marker color |
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
| `geomColor` | `string?` | `"#00ff00"` | Color for wireframe geoms |
| `siteColor` | `string?` | `"#ff00ff"` | Color for site markers |
| `contactColor` | `string?` | `"#ff4444"` | Color for contact force arrows |
| `comColor` | `string?` | `"#ff0000"` | Color for COM markers |

### `<TendonRenderer />`

Renders tendons as tube geometry from wrap paths.

### `<FlexRenderer />`

Renders deformable flex bodies from `flexvert_xpos`.

### `<ContactListener />`

Component wrapper for contact events:

```tsx
<ContactListener
  body="block_1"
  onContactEnter={(info) => console.log("contact!", info)}
  onContactExit={(info) => console.log("released", info)}
/>
```

### `<TrajectoryPlayer />`

Plays back recorded qpos trajectories with scrubbing.

## Hooks

### `useMujoco()`

Access the simulation API (must be inside `<MujocoCanvas>` or `<MujocoPhysics>`). Narrow on `isReady`, `isPending`, or `isError`:

```tsx
const sim = useMujoco();
if (sim.isReady) {
  sim.api.reset(); // fully typed
}
```

### `useMujocoWasm()`

Access the raw WASM module lifecycle from any child of `<MujocoProvider>`. Most users won't need this — `useMujoco()` and hooks like `useBeforePhysicsStep` handle the model/data lifecycle for you.

```tsx
import { useMujocoWasm } from "mujoco-react";

const { mujoco, status } = useMujocoWasm();

if (mujoco) {
  const model = mujoco.MjModel.loadFromXML("/path/to/scene.xml");
  const data = new mujoco.MjData(model);
  mujoco.mj_step(model, data);
  console.log(data.qpos);  // joint positions after one step
}
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

### `useIkController(config | null)`

Set up IK control for a MuJoCo site. Pass `null` to disable. Returns `IkContextValue | null`.

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

Read sensor values by name. Returns a `SensorHandle` with `read()`, `dim`, and `name`:

```tsx
const force = useSensor("force_sensor_1");
// force.read() -> Float64Array, force.dim -> number
```

### `useBodyState(name)`

Position, quaternion, linear/angular velocity of a body (ref-based):

```tsx
const { position, quaternion, linearVelocity, angularVelocity } = useBodyState("block_1");
```

### `useJointState(name)`

Joint position and velocity:

```tsx
const { position, velocity } = useJointState("joint1");
```

### `useCtrl(name)`

Read/write actuator control by name. Returns a `CtrlHandle` with `read()`, `write()`, `name`, and `range`:

```tsx
const gripper = useCtrl("gripper");
// gripper.read() -> number, gripper.write(0.04), gripper.range -> [min, max]
```

### `useContacts(bodyName?)` / `useContactEvents(bodyName, handlers)`

Query contacts or subscribe to enter/exit events:

```tsx
useContactEvents("block_1", {
  onEnter: (info) => console.log("contact!", info),
  onExit: (info) => console.log("released", info),
});
```

### `useKeyboardTeleop(config)`

Map keyboard keys to actuators:

```tsx
useKeyboardTeleop({
  bindings: {
    "w": { actuator: "forward", delta: 0.1 },
    "s": { actuator: "forward", delta: -0.1 },
    "v": { actuator: "gripper", toggle: [0, 0.04] },
  },
});
```

### `useGamepad(config)`

Map gamepad axes/buttons to actuators:

```tsx
useGamepad({
  axes: { 0: "joint1", 1: "joint2" },
  buttons: { 0: "gripper" },
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
const recorder = useTrajectoryRecorder({ fields: ["qpos", "qvel", "ctrl"] });
// recorder.start(), recorder.stop(), recorder.downloadJSON(), recorder.downloadCSV()

const player = useTrajectoryPlayer(trajectory, { fps: 30, loop: true });
// player.play(), player.pause(), player.seek(frameIdx)
```

### `useVideoRecorder(config)`

Record the canvas as video:

```tsx
const video = useVideoRecorder({ fps: 30, mimeType: "video/webm" });
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

### `useBodyMeshes(bodyId)`

Returns the Three.js meshes belonging to a MuJoCo body. Use for custom selection visuals, outlines, postprocessing, or any per-body mesh manipulation:

```tsx
const meshes = useBodyMeshes(selectedBodyId);

// Use with drei Outline, or manipulate materials directly
```

### `useSelectionHighlight(bodyId, options?)`

Convenience wrapper around `useBodyMeshes` that applies an emissive highlight:

```tsx
useSelectionHighlight(selectedBodyId, { color: "#00ff00", emissiveIntensity: 0.5 });
```

### `useSceneLights(intensity?)`

Hook form of `<SceneLights>`. Create Three.js lights from MJCF definitions imperatively:

```tsx
useSceneLights(1.5);
```

## MujocoSimAPI

The full API object available via `ref` or `useMujoco()` (when `isReady`):

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

See [Building Controllers](https://dadd.mintlify.app/guides/building-controllers) for full patterns including config-driven controllers, IK gizmo coexistence, multi-arm support, and the `createController` factory.

### Contact Parameters

Objects that need stable contact (grasping, stacking, etc.) require tuned MuJoCo solver parameters — `friction`, `solref`, `solimp`, and `condim`. See [Contact Parameters](https://dadd.mintlify.app/guides/graspable-objects) for details.

### Click-to-Select

Combine R3F raycasting with `useSelectionHighlight` for body selection:

```tsx
function ClickSelectOverlay() {
  const selectedBodyId = useClickSelect(); // your raycasting hook
  useSelectionHighlight(selectedBodyId);
  return null;
}
```

See [Click-to-Select](https://dadd.mintlify.app/guides/click-to-select) for the full implementation.

## useFrame Priority

| Priority | Owner | Purpose |
|----------|-------|---------|
| -1 | MujocoSimProvider | beforeStep, mj_step, afterStep |
| 0 (default) | SceneRenderer (internal), useIkController, your code | Body mesh sync, IK, rendering |

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
| **Register codegen** | P2 | CLI to auto-generate `Register` type augmentation from MJCF XML |

### WASM Limitations (mujoco-js 0.0.7)

These MuJoCo features are not yet exposed in the WASM binding:

- `flex_faceadr` / `flex_facenum` / `flex_face` -- FlexRenderer renders vertices without face indices
- `ten_rgba` / `ten_width` -- TendonRenderer uses default color/width

## License

Apache-2.0
