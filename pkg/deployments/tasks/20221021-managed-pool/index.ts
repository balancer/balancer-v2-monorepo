import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ManagedPoolDeployment } from './input';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ManagedPoolDeployment;

  const addRemoveTokenLib = await task.deployAndVerify('ManagedPoolAddRemoveTokenLib', [], from, force);
  const circuitBreakerLib = await task.deployAndVerify('CircuitBreakerLib', [], from, force);

  const args = [input.Vault, input.ProtocolFeePercentagesProvider];
  const factory = await task.deployAndVerify('ManagedPoolFactory', args, from, force, {
    CircuitBreakerLib: circuitBreakerLib.address,
    ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
  });

  const pool = await factory.create(
    {
      name: 'Deployment Test Pool',
      symbol: 'DTP',
      tokens: ['0xba100000625a3754423978a60c9317c58a424e3D', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
      normalizedWeights: [fp(0.5), fp(0.5)],
      assetManagers: [ZERO_ADDRESS, ZERO_ADDRESS],
      swapFeePercentage: fp(0.1),
      swapEnabledOnStart: false,
      mustAllowlistLPs: true,
      managementAumFeePercentage: 0,
      aumFeeId: 3,
    },
    ZERO_ADDRESS
  );

  console.log(pool);

  const math = await factory.getWeightedMath();
  await task.verify('ExternalWeightedMath', math, []);
};
