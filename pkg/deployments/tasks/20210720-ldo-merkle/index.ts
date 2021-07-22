import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { MerkleRedeemDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as MerkleRedeemDeployment;
  const args = [input.vault, input.ldoToken];

  if (task.network != 'mainnet') throw new Error('LDO MerkleRedeem can only be deployed on mainnet');

  if (force || !output.distributor) {
    const distributor = await task.deploy('MerkleRedeem', args, from);
    task.save({ distributor });
    await task.verify('MerkleRedeem', distributor.address, args);
  } else {
    logger.info(`MerkleRedeem already deployed at ${output.distributor}`);
    await task.verify('MerkleRedeem', output.distributor, args);
  }
};
