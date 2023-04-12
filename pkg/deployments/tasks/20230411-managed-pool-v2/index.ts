import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ManagedPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ManagedPoolDeployment;

  const addRemoveTokenLib = await task.deployAndVerify('ManagedPoolAddRemoveTokenLib', [], from, force);
  const circuitBreakerLib = await task.deployAndVerify('CircuitBreakerLib', [], from, force);
  const libs = { CircuitBreakerLib: circuitBreakerLib.address };
  const ammLib = await task.deployAndVerify('ManagedPoolAmmLib', [], from, force, libs);

  const args = [
    input.Vault,
    input.ProtocolFeePercentagesProvider,
    input.FactoryVersion,
    input.PoolVersion,
    input.InitialPauseWindowDuration,
    input.BufferPeriodDuration,
  ];

  const factory = await task.deployAndVerify('ManagedPoolFactory', args, from, force, {
    CircuitBreakerLib: circuitBreakerLib.address,
    ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
    ManagedPoolAmmLib: ammLib.address,
  });

  const math = await factory.getWeightedMath();
  await task.verify('ExternalWeightedMath', math, []);
};
