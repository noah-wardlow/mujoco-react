import {
  bodyPositionField,
  ctrlField,
  controlGroup,
  createNamedObservationBuilder,
  defineControls,
  qposField,
  readNamedObservation,
  sitePositionField,
  useBodyPose,
  useContactHistory,
  useControlGroup,
  useControlWriter,
  useControls,
  useGeomPose,
  useNamedObservation,
  useSitePose,
  type NamedObservationField,
} from '../src';
import type { MujocoData, MujocoModel } from '../src';

const fields: NamedObservationField[] = [
  qposField('joint0', 0, 'radians'),
  ctrlField('ctrl0', 0, 'radians'),
  bodyPositionField('box'),
  sitePositionField('gripper'),
];

function readObservation(model: MujocoModel, data: MujocoData) {
  const result = readNamedObservation(model, data, {
    fields,
    missing: 'zeros',
  });
  result.layout[0]?.units?.toUpperCase();

  const build = createNamedObservationBuilder({
    fields,
    output: 'float64',
  });
  build(model, data).values.BYTES_PER_ELEMENT.toFixed();
}

function PrimitiveHarness() {
  const bodyPose = useBodyPose('box');
  const geomPose = useGeomPose('box_geom');
  const sitePose = useSitePose('gripper');
  bodyPose.position.current.toArray();
  geomPose.quaternion.current.toArray();
  sitePose.found.current.valueOf();

  const observation = useNamedObservation({
    fields: [
      qposField('shoulder_pan', 0, 'radians'),
      bodyPositionField('box'),
    ],
  });
  observation.read().layout.map((item) => item.name);
  observation.readValues().length.toFixed();

  const history = useContactHistory({
    bodyNames: ['box'],
    maxLength: 100,
  });
  history.countPair('box', 'table').toFixed();
  history.clear();

  const writer = useControlWriter({
    owner: 'policy',
    selector: {
      actuators: ['shoulder_pan', 'shoulder_lift'],
    },
  });
  writer.canWrite().valueOf();
  writer.write([0, 1]);
  writer.conflicts.current.map((conflict) => conflict.owner);

  const armGroup = controlGroup(['shoulder_pan', 'shoulder_lift']);
  const group = useControlGroup(armGroup);
  group.set('shoulder_pan', 0.1);
  group.patch({ shoulder_lift: 0.2 });
  group.write([0.1, 0.2]);
  group.get('shoulder_pan').toFixed();
  group.read().shoulder_lift.toFixed();
  // @ts-expect-error wrong actuator name for the declared group
  group.set('elbow', 0.3);

  const armControls = defineControls({
    shoulder: 'shoulder_pan',
    lift: 'shoulder_lift',
  });
  const controls = useControls(armControls);
  controls.set('shoulder', 0.1);
  controls.patch({ lift: 0.2 });
  controls.write([0.1, 0.2]);
  controls.get('shoulder').toFixed();
  controls.read().lift.toFixed();
  // @ts-expect-error aliases, not raw actuator names
  controls.set('shoulder_pan', 0.1);
  // @ts-expect-error wrong alias
  controls.patch({ elbow: 0.3 });

  return null;
}

void readObservation;
void PrimitiveHarness;
