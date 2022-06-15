import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { MerkleRedeemDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as MerkleRedeemDeployment;

  const args = [input.Vault, input.balToken];
  await task.deployAndVerify('MerkleRedeem', args, from, force);
};
