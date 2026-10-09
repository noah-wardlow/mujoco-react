import { GenericIK, MujocoCanvas, MujocoProvider, useCtrl } from '../src';
import type {
  Actuators,
  MujocoModule,
  MujocoModel,
  MujocoData,
  MujocoSimAPI,
  MujocoIntegrator,
} from '../src';

declare const module: MujocoModule,
  model: MujocoModel,
  data: MujocoData,
  api: MujocoSimAPI,
  actuator: Actuators;
const solver = new GenericIK(module);
solver.solveJoints(model, data, 0, [0], { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
api.setCtrl(actuator, [0, 0, 0]);
api.setCtrl(actuator, 1);
api.getActuators().map((a) => [a.ctrlAdr, a.ctrlCount, a.ranges]);
const integrator: MujocoIntegrator = 'discrete';
function Example() {
  const control = useCtrl(actuator, 1);
  control.write(0);
  return (
    <MujocoProvider threadCount={0}>
      <MujocoCanvas config={{ src: '/', sceneFile: 'scene.xml' }} integrator={integrator} />
    </MujocoProvider>
  );
}
void Example;
// @ts-expect-error invalid integrator
const invalid: MujocoIntegrator = 'not-an-integrator';
void invalid;
