import '@nomiclabs/hardhat-ethers';
import 'hardhat-local-networks-config-plugin';

import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import Task from './src/task';
import { Logger } from './src/logger';

task('deploy', 'Run deployment task')
  .addParam('task', 'Deployment task ID')
  .addOptionalParam('force', 'Whether the task to deploy must be ignore previous deployments or not')
  .setAction(async (args: { id: string; force?: boolean; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
    Logger.setDefaults(false, args.verbose || false);
    await new Task(args.id, hre.network.name).run(args.force);
  });

export default {};
