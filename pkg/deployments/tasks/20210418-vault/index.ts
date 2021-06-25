import Task from '../../src/task';

import logger from '../../src/logger';
import { VaultDeployment } from './input';

export default async (task: Task, force = false): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as VaultDeployment;

  const args = [input.authorizer, input.weth, input.pauseWindowDuration, input.bufferPeriodDuration];

  if (force || !output.vault) {
    const vault = await task.deploy('Vault', args);
    task.save({ vault });
    await task.verify('Vault', vault.address, args);
  } else {
    logger.info(`Vault already deployed at ${output.vault}`);
    await task.verify('Vault', output.vault, args);
  }
};
