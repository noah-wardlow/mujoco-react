import type { MujocoModule, MujocoModel, MujocoData } from '../src';

export function configureContactsAndReadPlasticity(
  module: MujocoModule, model: MujocoModel, data: MujocoData,
): Float64Array {
  model.opt.enableflags |= module.mjtEnableBit.mjENBL_SPECULATIVE.value;
  const address: number = model.jnt_plasticadr[0];
  const count: number = model.nplastic;
  return data.plastic.subarray(Math.max(0, address), count);
}
