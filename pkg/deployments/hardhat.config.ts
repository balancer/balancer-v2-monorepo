import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import 'hardhat-local-networks-config-plugin';

import '@balancer-labs/v2-common/setupTests';

import { task, types } from 'hardhat/config';
import { TASK_TEST } from 'hardhat/builtin-tasks/task-names';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import test from './src/test';
import Task, { TaskMode } from './src/task';
import Verifier from './src/verifier';
import { Logger } from './src/logger';
import path from 'path';
import { readdirSync } from 'fs';

task('deploy', 'Run deployment task')
  .addParam('id', 'Deployment task ID')
  .addFlag('force', 'Ignore previous deployments')
  .addOptionalParam('key', 'Etherscan API key to verify contracts')
  .setAction(
    async (args: { id: string; force?: boolean; key?: string; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
      Logger.setDefaults(false, args.verbose || false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiKey = args.key ?? (hre.config.networks[hre.network.name] as any).verificationAPIKey;
      const verifier = apiKey ? new Verifier(hre.network, apiKey) : undefined;
      await new Task(args.id, TaskMode.LIVE, hre.network.name, verifier).run(args);
    }
  );

task('verify-contract', `Verify a task's deployment on a block explorer`)
  .addParam('id', 'Deployment task ID')
  .addParam('name', 'Contract name')
  .addParam('address', 'Contract address')
  .addParam('args', 'ABI-encoded constructor arguments')
  .addParam('key', 'Etherscan API key to verify contracts')
  .setAction(
    async (
      args: { id: string; name: string; address: string; key: string; args: string; verbose?: boolean },
      hre: HardhatRuntimeEnvironment
    ) => {
      Logger.setDefaults(false, args.verbose || false);
      const verifier = args.key ? new Verifier(hre.network, args.key) : undefined;

      await new Task(args.id, TaskMode.READ_ONLY, hre.network.name, verifier).verify(
        args.name,
        args.address,
        args.args
      );
    }
  );

task('check-deployment', `Check that all tasks' deployments correspond to their build-info and inputs`)
  .addOptionalParam('id', 'Specific task ID')
  .setAction(async (args: { id?: string; force?: boolean; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
    // The force argument above is actually not passed (and not required or used in CHECK mode), but it is the easiest
    // way to address type issues.

    Logger.setDefaults(false, args.verbose || false);

    if (args.id) {
      await new Task(args.id, TaskMode.CHECK, hre.network.name).run(args);
    } else {
      const taskDirectory = path.resolve(__dirname, './tasks');

      for (const taskID of readdirSync(taskDirectory)) {
        const outputFiless = readdirSync(path.resolve(taskDirectory, taskID, 'output'));
        if (outputFiless.filter((outputFile) => outputFile.includes(hre.network.name)).length == 0) {
          // Not all tasks have outputs for all networks, so we skip those that don't
          continue;
        }

        await new Task(taskID, TaskMode.CHECK, hre.network.name).run(args);
      }
    }
  });

task(TASK_TEST)
  .addOptionalParam('fork', 'Optional network name to be forked block number to fork in case of running fork tests.')
  .addOptionalParam('blockNumber', 'Optional block number to fork in case of running fork tests.', undefined, types.int)
  .setAction(test);

export default {
  mocha: {
    timeout: 600000,
  },
};
