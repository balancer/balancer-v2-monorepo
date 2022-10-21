import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ManagedPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ManagedPoolDeployment;

  const addRemoveTokenLib = await task.deployAndVerify('ManagedPoolAddRemoveTokenLib');
  const circuitBreakerLib = await task.deployAndVerify('CircuitBreakerLib');

  const args = [input.Vault, input.ProtocolFeePercentagesProvider];
  await task.deployAndVerify('ManagedPoolFactory', args, from, force, {
    CircuitBreakerLib: circuitBreakerLib.address,
    ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
  });
};
