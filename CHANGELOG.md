## [10.2.1](https://github.com/noah-wardlow/mujoco-react/compare/v10.2.0...v10.2.1) (2026-06-22)


### Bug Fixes

* expose policy queue depth and capture mirroring ([75f0cdf](https://github.com/noah-wardlow/mujoco-react/commit/75f0cdf95ff9b59562acac710759c7d9f30ffa3f))

# [10.2.0](https://github.com/noah-wardlow/mujoco-react/compare/v10.1.0...v10.2.0) (2026-06-22)


### Features

* add image point projection API ([e195347](https://github.com/noah-wardlow/mujoco-react/commit/e195347fc43e34493977f0eb82e4a61cb1e7af19))

# [10.1.0](https://github.com/noah-wardlow/mujoco-react/compare/v10.0.1...v10.1.0) (2026-06-22)


### Features

* add policy primitives and camera capture controls ([88d0e30](https://github.com/noah-wardlow/mujoco-react/commit/88d0e305a0df9390f9b08c04a161360ffc353c22))

## [10.0.1](https://github.com/noah-wardlow/mujoco-react/compare/v10.0.0...v10.0.1) (2026-06-21)


### Bug Fixes

* preserve IK solver defaults ([5dfa070](https://github.com/noah-wardlow/mujoco-react/commit/5dfa070469a66f8967cbad0f2e74bb3d2f9ffd32))

# [10.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v9.6.0...v10.0.0) (2026-06-21)


### Features

* stabilize model resource API for 10.0 ([864c002](https://github.com/noah-wardlow/mujoco-react/commit/864c002410b4e648f538efd176c1414b5665b0c6))


### BREAKING CHANGES

* Generated resource APIs now use Model-prefixed names and Register.models. Robot-prefixed generated resource exports and registerRobotResources were removed before the 10.0 stable API line. Replace RobotActuators/RobotJoints/RobotSites/etc. with ModelActuators/ModelJoints/ModelSites/etc., and replace registerRobotResources/Register.robots with registerModelResources/Register.models.

Co-Authored-By: OpenAI Codex <noreply@openai.com>

# [9.6.0](https://github.com/noah-wardlow/mujoco-react/compare/v9.5.0...v9.6.0) (2026-06-21)


### Features

* add keyboard IK target controls ([7aac8f4](https://github.com/noah-wardlow/mujoco-react/commit/7aac8f47600d418cc6b142c900b19aaafc5350f6))

# [9.5.0](https://github.com/noah-wardlow/mujoco-react/compare/v9.4.0...v9.5.0) (2026-06-19)


### Features

* improve mounted camera capture ([f33e445](https://github.com/noah-wardlow/mujoco-react/commit/f33e445645a5daedcfe5689bfa33a63a349ca08f))

# [9.4.0](https://github.com/noah-wardlow/mujoco-react/compare/v9.3.0...v9.4.0) (2026-06-17)


### Features

* release splat and camera workflow APIs ([004b5d8](https://github.com/noah-wardlow/mujoco-react/commit/004b5d85edc0b4b250af90b6743e07663e7f1b93))

# [9.3.0](https://github.com/noah-wardlow/mujoco-react/compare/v9.2.0...v9.3.0) (2026-06-15)


### Features

* add mounted camera dataset capture ([1b9dfc7](https://github.com/noah-wardlow/mujoco-react/commit/1b9dfc7d49ff52eac64c71a5ffb0235969a112bd))

# [9.2.0](https://github.com/noah-wardlow/mujoco-react/compare/v9.1.0...v9.2.0) (2026-06-14)


### Features

* add fixed camera capture APIs ([889efc3](https://github.com/noah-wardlow/mujoco-react/commit/889efc352f3c3d75a919841fe1d3b36c955bc2f7))

# [9.1.0](https://github.com/noah-wardlow/mujoco-react/compare/v9.0.0...v9.1.0) (2026-06-14)


### Features

* add canvas frame capture api ([130181e](https://github.com/noah-wardlow/mujoco-react/commit/130181e7b7534f6535d1040417daf14f606f8fa3))

# [9.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.11.0...v9.0.0) (2026-06-14)


### Features

* use object-style public callbacks ([7cf3d12](https://github.com/noah-wardlow/mujoco-react/commit/7cf3d12e08630ad3d8e12496a6693108de96b780))


### BREAKING CHANGES

* Public callbacks now receive a single named input object instead of positional arguments. Update useBeforePhysicsStep, useAfterPhysicsStep, onReset, onReady, onStep, onSelection, IkGizmo onDrag, IKSolveFn, materialFilter, and trajectory callbacks to destructure named fields.

Co-Authored-By: OpenAI Codex <noreply@openai.com>

# [8.11.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.10.0...v8.11.0) (2026-06-14)


### Features

* add composable splat scene workflows ([8ef58a5](https://github.com/noah-wardlow/mujoco-react/commit/8ef58a515e6215935bd894765eaa1abfe106b785))

# [8.10.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.9.2...v8.10.0) (2026-06-14)


### Features

* add gaussian splat environments ([41d0d57](https://github.com/noah-wardlow/mujoco-react/commit/41d0d57a9e6afc30b67c33a5c40711c5fc4aa6c0))

## [8.9.2](https://github.com/noah-wardlow/mujoco-react/compare/v8.9.1...v8.9.2) (2026-06-06)


### Bug Fixes

* simplify vite type generation docs ([0bc7cd2](https://github.com/noah-wardlow/mujoco-react/commit/0bc7cd28a2dfc95f0d7a0ba3dbd277f7d9c02a64))

## [8.9.1](https://github.com/noah-wardlow/mujoco-react/compare/v8.9.0...v8.9.1) (2026-06-06)


### Bug Fixes

* align docs with generated resource values ([98b7b03](https://github.com/noah-wardlow/mujoco-react/commit/98b7b034c1c559f72712bd005e0ef6f7194ef4a7))

# [8.9.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.8.0...v8.9.0) (2026-06-06)


### Features

* generate typed robot resource values ([6f98e83](https://github.com/noah-wardlow/mujoco-react/commit/6f98e83c6a97ae1b5995383e36b18dafefff78e6))

# [8.8.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.7.0...v8.8.0) (2026-06-06)


### Features

* add generated robot namespace types ([ec1e659](https://github.com/noah-wardlow/mujoco-react/commit/ec1e65968216c6ee223c1df5d03688f70fa76135))

# [8.7.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.6.0...v8.7.0) (2026-06-05)


### Features

* add per-robot register type generation ([a09a12f](https://github.com/noah-wardlow/mujoco-react/commit/a09a12f6038ab3467dea4c7cc454fa657e64c418))

# [8.6.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.5.0...v8.6.0) (2026-06-05)


### Features

* add local loading and vite codegen ([3d4e125](https://github.com/noah-wardlow/mujoco-react/commit/3d4e125098ad303ddb98e15026c80967d0db0cd3))

# [8.5.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.4.2...v8.5.0) (2026-06-05)


### Features

* add observation builder utilities ([3d5a12a](https://github.com/noah-wardlow/mujoco-react/commit/3d5a12af263609f9c84c71c57f7624669e5b6a80))

## [8.4.2](https://github.com/noah-wardlow/mujoco-react/compare/v8.4.1...v8.4.2) (2026-06-05)


### Bug Fixes

* reduce websocket readme boilerplate ([77cd6da](https://github.com/noah-wardlow/mujoco-react/commit/77cd6da1cb95bff38a7e6e5044409189748039fb))

## [8.4.1](https://github.com/noah-wardlow/mujoco-react/compare/v8.4.0...v8.4.1) (2026-06-05)


### Bug Fixes

* simplify readme opening examples ([0fca2f6](https://github.com/noah-wardlow/mujoco-react/commit/0fca2f675c0e97c5156edc1527225839bd809aab))

# [8.4.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.3.3...v8.4.0) (2026-06-05)


### Features

* improve wasm controls and ik mapping ([ab171e8](https://github.com/noah-wardlow/mujoco-react/commit/ab171e8f4fc525e01f8b56cf98888825ee290488))

## [8.3.3](https://github.com/noah-wardlow/mujoco-react/compare/v8.3.2...v8.3.3) (2026-06-05)


### Bug Fixes

* sync package lock release version ([c973642](https://github.com/noah-wardlow/mujoco-react/commit/c9736427ffc5c80d70b605a180788b6691d9e523))

## [8.3.2](https://github.com/noah-wardlow/mujoco-react/compare/v8.3.1...v8.3.2) (2026-06-05)


### Bug Fixes

* use npm token for node auth ([02ef269](https://github.com/noah-wardlow/mujoco-react/commit/02ef26913a204802a0d6fe450a7d3e3291e7d8ad))

## [8.3.1](https://github.com/noah-wardlow/mujoco-react/compare/v8.3.0...v8.3.1) (2026-06-05)


### Bug Fixes

* normalize npm repository metadata ([dab8213](https://github.com/noah-wardlow/mujoco-react/commit/dab8213178ec6d25c2170612c1ef9662110b438c))

# [8.3.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.2.1...v8.3.0) (2026-06-05)


### Features

* migrate to official mujoco wasm bindings ([c956faf](https://github.com/noah-wardlow/mujoco-react/commit/c956faf9e966fb6a64f096f339baa142f20f209a))

## [8.2.1](https://github.com/noah-wardlow/mujoco-react/compare/v8.2.0...v8.2.1) (2026-02-24)


### Bug Fixes

* update npm package README with simplified controller examples ([9bb031f](https://github.com/noah-wardlow/mujoco-react/commit/9bb031f7cdcbfbf2fd6a898fec27db8e7a6eca30))

# [8.2.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.1.1...v8.2.0) (2026-02-24)


### Features

* export createControllerHook and document hook-based controller pattern ([1a3c336](https://github.com/noah-wardlow/mujoco-react/commit/1a3c336f439cca40204213f4d8923e2de5cf06f4))

## [8.1.1](https://github.com/noah-wardlow/mujoco-react/compare/v8.1.0...v8.1.1) (2026-02-24)


### Bug Fixes

* parallelize asset downloads in scene loader for faster initial load ([16115f6](https://github.com/noah-wardlow/mujoco-react/commit/16115f6d83a60c4c0f83388c5cbe6816fa51ec39))

# [8.1.0](https://github.com/noah-wardlow/mujoco-react/compare/v8.0.0...v8.1.0) (2026-02-22)


### Features

* upgrade trajectory player with state machine, speed control, and physics mode ([9706d49](https://github.com/noah-wardlow/mujoco-react/commit/9706d49f3bfb506b6c7c820995544a0d897314cc))

# [8.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v7.0.1...v8.0.0) (2026-02-22)


### Features

* add Register pattern and handle-based useCtrl/useSensor ([fdead7d](https://github.com/noah-wardlow/mujoco-react/commit/fdead7d92b0868e12bd52935ea8c66c1cd71a175))


### BREAKING CHANGES

* useCtrl returns CtrlHandle instead of [RefObject, setter] tuple.
useSensor returns SensorHandle instead of SensorResult { value, size }.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

## [7.0.1](https://github.com/noah-wardlow/mujoco-react/compare/v7.0.0...v7.0.1) (2026-02-22)


### Bug Fixes

* remove duplicate useMujoco() call in README example ([8bb7fe5](https://github.com/noah-wardlow/mujoco-react/commit/8bb7fe59c50de4eabe37e2ed67ece2a6a2024efd))

# [7.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v6.0.1...v7.0.0) (2026-02-22)


### Features

* add <Body> component, refactor IK to useIkController hook ([6d9ccbe](https://github.com/noah-wardlow/mujoco-react/commit/6d9ccbe281137788093c4902dbba5941d3587a58))


### BREAKING CHANGES

* <IkController> component and useIk() hook removed. Use useIkController() hook instead:
  const ik = useIkController({ siteName: 'tcp', numJoints: 7 });
  return ik ? <IkGizmo controller={ik} /> : null;

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

## [6.0.1](https://github.com/noah-wardlow/mujoco-react/compare/v6.0.0...v6.0.1) (2026-02-22)


### Bug Fixes

* restructure docs navigation so overview is the landing page ([e4f4309](https://github.com/noah-wardlow/mujoco-react/commit/e4f4309158ebd86b2d2d2c586331bb4737451ddf))

# [6.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v5.0.0...v6.0.0) (2026-02-22)


### Features

* add useBodyMeshes hook, remove SelectionHighlight component ([a273979](https://github.com/noah-wardlow/mujoco-react/commit/a273979295bd7cebf01b92fc7b288d960da89ea2))


### BREAKING CHANGES

* <SelectionHighlight> component is removed.
Use useSelectionHighlight(bodyId) hook or useBodyMeshes(bodyId)
for custom visuals.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [5.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v4.0.0...v5.0.0) (2026-02-22)


### Features

* replace modelId + baseUrl with src in SceneConfig ([44029d5](https://github.com/noah-wardlow/mujoco-react/commit/44029d5b97680b3a1af8a8c473cdb7bd79532550))


### BREAKING CHANGES

* SceneConfig.modelId and SceneConfig.baseUrl are removed.
Use SceneConfig.src (required) as the base URL for model files.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [4.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v3.0.0...v4.0.0) (2026-02-22)


### Features

* rename robotId to modelId in SceneConfig ([5452189](https://github.com/noah-wardlow/mujoco-react/commit/545218937c3678552c2af7044ad89a252d2a1e7d))


### BREAKING CHANGES

* SceneConfig.robotId is now SceneConfig.modelId.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [3.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v2.0.0...v3.0.0) (2026-02-22)


### Features

* rename useMujocoSim() to useMujoco() and useMujoco() to useMujocoWasm() ([3399402](https://github.com/noah-wardlow/mujoco-react/commit/33994022d1b5130fe3da1155d27796f29c29ad7e))


### BREAKING CHANGES

* useMujocoSim() is now useMujoco() (sim API hook).
The old useMujoco() (WASM lifecycle) is now useMujocoWasm().
Updated README, docs, and all internal references.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [2.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v1.0.0...v2.0.0) (2026-02-22)


### Features

* render SceneRenderer automatically inside MujocoSimProvider ([cda052e](https://github.com/noah-wardlow/mujoco-react/commit/cda052ed7de05ba1f735a389519156addbec03fd))


### BREAKING CHANGES

* SceneRenderer is no longer exported. Remove <SceneRenderer /> from your JSX and its import.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# 1.0.0 (2026-02-22)


### Features

* add MujocoPhysics component and modernize R3F patterns ([0679c27](https://github.com/noah-wardlow/mujoco-react/commit/0679c272d24f29d70331026ce05f3b57f9c14bef))


### BREAKING CHANGES

* removed interpolate, gravityCompensation, mjcfLights
props from MujocoCanvas. Removed tcpSiteName, gripperActuatorName,
numArmJoints from SceneConfig. Use useGravityCompensation() hook and
IkController config instead.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# 1.0.0 (2026-02-22)


### Features

* add MujocoPhysics component and modernize R3F patterns ([0679c27](https://github.com/noah-wardlow/mujoco-react/commit/0679c272d24f29d70331026ce05f3b57f9c14bef))


### BREAKING CHANGES

* removed interpolate, gravityCompensation, mjcfLights
props from MujocoCanvas. Removed tcpSiteName, gripperActuatorName,
numArmJoints from SceneConfig. Use useGravityCompensation() hook and
IkController config instead.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
