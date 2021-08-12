import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { MerkleRedeemDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  if (task.network != 'mainnet') throw new Error('LDO MerkleRedeem can only be deployed on mainnet');

  const input = task.input() as MerkleRedeemDeployment;
  const args = [input.Vault, input.ldoToken];
  await task.deployAndVerify('MerkleRedeem', args, from, force);
};
