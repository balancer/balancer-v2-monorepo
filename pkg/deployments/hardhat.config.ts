import '@nomiclabs/hardhat-ethers';
import 'hardhat-local-networks-config-plugin';

import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import Task from './src/task';
import { Logger } from './src/logger';

task('deploy', 'Run deployment task')
  .addParam('id', 'Deployment task ID')
  .addOptionalParam('force', 'Ignore previous deployments')
  .setAction(async (args: { id: string; force?: boolean; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
    Logger.setDefaults(false, args.verbose || false);
    await new Task(args.id, hre.network.name).run(args.force);
  });

export default {};
