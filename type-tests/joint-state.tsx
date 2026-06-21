import { useJointState } from '../src';
import type {
  ArrayJointStateResult,
  JointStateResult,
  ScalarJointStateResult,
} from '../src';

function JointStateHarness() {
  const scalar: ScalarJointStateResult = useJointState('hinge_joint', { kind: 'scalar' });
  const array: ArrayJointStateResult = useJointState('free_joint', { kind: 'array' });
  const inferred: JointStateResult = useJointState('any_joint');

  scalar.position.current.toFixed();
  scalar.velocity.current.toFixed();
  array.position.current.byteLength.toFixed();
  array.velocity.current.byteLength.toFixed();

  const value = inferred.position.current;
  if (typeof value === 'number') {
    value.toFixed();
  } else {
    value.byteLength.toFixed();
  }

  return null;
}

void JointStateHarness;
