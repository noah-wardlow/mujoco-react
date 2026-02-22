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
