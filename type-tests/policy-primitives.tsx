import {
  bodyPositionField,
  ctrlField,
  createNamedObservationBuilder,
  qposField,
  readNamedObservation,
  sitePositionField,
  useBodyPose,
  useContactHistory,
  useControlWriter,
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

  return null;
}

void readObservation;
void PrimitiveHarness;
