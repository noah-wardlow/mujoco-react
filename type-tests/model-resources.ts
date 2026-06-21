import {
  ModelActuators,
  ModelResources,
  registerModelResources,
} from '../src';
import type {
  ModelActuators as ModelActuatorNames,
  ModelResource,
  Models,
} from '../src';

declare module '../src' {
  interface Register {
    models: {
      demo: {
        actuators: 'motor';
        sensors: never;
        bodies: 'base';
        joints: 'hinge';
        sites: 'tip';
        geoms: 'floor';
        keyframes: never;
        cameras: never;
      };
    };
  }
}

const modelName: Models = 'demo';
const modelActuator: ModelResource<'demo', 'actuators'> = 'motor';
const scopedModelActuator: ModelActuatorNames<'demo'> = 'motor';

registerModelResources({
  demo: {
    actuators: { motor: 'motor' },
    sensors: {},
    bodies: { base: 'base' },
    joints: { hinge: 'hinge' },
    sites: { tip: 'tip' },
    geoms: { floor: 'floor' },
    keyframes: {},
    cameras: {},
  },
});

ModelActuators.demo.motor.toUpperCase();
ModelResources.demo.actuators.motor.toUpperCase();

void modelName;
void modelActuator;
void scopedModelActuator;
