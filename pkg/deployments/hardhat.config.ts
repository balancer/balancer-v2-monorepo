import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import 'hardhat-local-networks-config-plugin';
import 'hardhat-ignore-warnings';

import '@balancer-labs/v2-common/setupTests';

import { task } from 'hardhat/config';
import { TASK_TEST } from 'hardhat/builtin-tasks/task-names';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { hardhatBaseConfig } from '@balancer-labs/v2-common';

import path from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';

import { checkArtifact, extractArtifact } from './src/artifact';
import test from './src/test';
import Task, { TaskMode } from './src/task';
import Verifier from './src/verifier';
import logger, { Logger } from './src/logger';
import { checkActionIds, checkActionIdUniqueness, saveActionIds } from './src/actionId';
import { saveContractDeploymentAddresses } from './src/network';
import { name } from './package.json';

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
  .addOptionalParam('key', 'Etherscan API key to verify contracts')
  .setAction(
    async (
      args: { id: string; name: string; address: string; key: string; args: string; verbose?: boolean },
      hre: HardhatRuntimeEnvironment
    ) => {
      Logger.setDefaults(false, args.verbose || false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiKey = args.key ?? (hre.config.networks[hre.network.name] as any).verificationAPIKey;
      const verifier = apiKey ? new Verifier(hre.network, apiKey) : undefined;

      // Contracts can only be verified in Live mode
      await new Task(args.id, TaskMode.LIVE, hre.network.name, verifier).verify(args.name, args.address, args.args);
    }
  );

task('extract-artifacts', `Extract contract artifacts from their build-info`)
  .addOptionalParam('id', 'Specific task ID')
  .addOptionalParam('file', 'Target build-info file name')
  .addOptionalParam('name', 'Contract name')
  .setAction(async (args: { id?: string; file?: string; name?: string; verbose?: boolean }) => {
    Logger.setDefaults(false, args.verbose || false);

    if (args.id) {
      const task = new Task(args.id, TaskMode.READ_ONLY);
      extractArtifact(task, args.file, args.name);
    } else {
      for (const taskID of Task.getAllTaskIds()) {
        const task = new Task(taskID, TaskMode.READ_ONLY);
        extractArtifact(task, args.file, args.name);
      }
    }
  });

task('check-deployments', `Check that all tasks' deployments correspond to their build-info and inputs`)
  .addOptionalParam('id', 'Specific task ID')
  .setAction(async (args: { id?: string; force?: boolean; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
    // The force argument above is actually not passed (and not required or used in CHECK mode), but it is the easiest
    // way to address type issues.

    Logger.setDefaults(false, args.verbose || false);
    logger.log(`Checking deployments for ${hre.network.name}...`, '');

    if (args.id) {
      await new Task(args.id, TaskMode.CHECK, hre.network.name).run(args);
    } else {
      for (const taskID of Task.getAllTaskIds()) {
        if (taskID.startsWith('00000000-')) {
          continue;
        }

        const task = new Task(taskID, TaskMode.CHECK, hre.network.name);
        const outputDir = path.resolve(task.dir(), 'output');

        if (existsSync(outputDir) && statSync(outputDir).isDirectory()) {
          const outputFiles = readdirSync(outputDir);
          if (outputFiles.some((outputFile) => outputFile.includes(hre.network.name))) {
            // Not all tasks have outputs for all networks, so we skip those that don't
            await task.run(args);
          }
        }
      }
    }
  });

task('check-artifacts', `check that contract artifacts correspond to their build-info`)
  .addOptionalParam('id', 'Specific task ID')
  .setAction(async (args: { id?: string; verbose?: boolean }) => {
    Logger.setDefaults(false, args.verbose || false);

    if (args.id) {
      const task = new Task(args.id, TaskMode.READ_ONLY);
      checkArtifact(task);
    } else {
      for (const taskID of Task.getAllTaskIds()) {
        const task = new Task(taskID, TaskMode.READ_ONLY);
        checkArtifact(task);
      }
    }
  });

task('save-action-ids', `Print the action IDs for a particular contract and checks their uniqueness`)
  .addOptionalParam('id', 'Specific task ID')
  .addOptionalParam('name', 'Contract name')
  .addOptionalParam('address', 'Address of Pool created from a factory')
  .setAction(
    async (args: { id: string; name: string; address?: string; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
      async function saveActionIdsTask(
        args: { id: string; name: string; address?: string; verbose?: boolean },
        hre: HardhatRuntimeEnvironment
      ) {
        Logger.setDefaults(false, args.verbose || false);

        // The user is calculating action IDs for a contract which isn't included in the task outputs.
        // Most likely this is for a pool which is to be deployed from a factory contract deployed as part of the task.
        if (args.address) {
          if (!args.id || !args.name) {
            throw new Error(
              "Provided an address for Pool created from a factory but didn't specify task or contract name."
            );
          }
          const task = new Task(args.id, TaskMode.READ_ONLY, hre.network.name);
          await saveActionIds(task, args.name, args.address);
          return;
        }

        // The user is calculating the action IDs for a particular task or contract within a particular task.
        if (args.id && args.name) {
          const task = new Task(args.id, TaskMode.READ_ONLY, hre.network.name);
          await saveActionIds(task, args.name);
          return;
        }

        async function generateActionIdsForTask(taskId: string): Promise<void> {
          const task = new Task(taskId, TaskMode.READ_ONLY, hre.network.name);
          const outputDir = path.resolve(task.dir(), 'output');

          if (existsSync(outputDir) && statSync(outputDir).isDirectory()) {
            for (const outputFile of readdirSync(outputDir)) {
              const outputFilePath = path.resolve(outputDir, outputFile);
              if (outputFile.includes(hre.network.name) && statSync(outputFilePath).isFile()) {
                const fileContents = JSON.parse(readFileSync(outputFilePath).toString());
                const contractNames = Object.keys(fileContents);

                for (const contractName of contractNames) {
                  await saveActionIds(task, contractName);
                }
              }
            }
          }
        }

        if (args.id) {
          await generateActionIdsForTask(args.id);
          return;
        }

        // We're calculating action IDs for whichever contracts we can pull enough information from disk for.
        // This will calculate action IDs for any contracts which are a named output from a task.
        for (const taskID of Task.getAllTaskIds()) {
          await generateActionIdsForTask(taskID);
        }
      }

      await saveActionIdsTask(args, hre);
      checkActionIdUniqueness(hre.network.name);
    }
  );

task('check-action-ids', `Check that contract action-ids correspond the expected values`)
  .addOptionalParam('id', 'Specific task ID')
  .setAction(async (args: { id?: string; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
    Logger.setDefaults(false, args.verbose || false);
    logger.log(`Checking action IDs for ${hre.network.name}...`, '');

    if (args.id) {
      const task = new Task(args.id, TaskMode.READ_ONLY, hre.network.name);
      await checkActionIds(task);
    } else {
      for (const taskID of Task.getAllTaskIds()) {
        const task = new Task(taskID, TaskMode.READ_ONLY, hre.network.name);
        await checkActionIds(task);
      }
    }
    checkActionIdUniqueness(hre.network.name);
  });

task('build-address-lookup', `Build a lookup table from contract addresses to the relevant deployment`)
  .addOptionalParam('id', 'Specific task ID')
  .setAction(async (args: { id?: string; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
    Logger.setDefaults(false, args.verbose || false);

    if (args.id) {
      const task = new Task(args.id, TaskMode.READ_ONLY, hre.network.name);
      saveContractDeploymentAddresses(task);
    } else {
      for (const taskID of Task.getAllTaskIds()) {
        if (taskID.startsWith('00000000-')) {
          continue;
        }
        const task = new Task(taskID, TaskMode.READ_ONLY, hre.network.name);
        saveContractDeploymentAddresses(task);
      }
    }
  });

task(TASK_TEST).addOptionalParam('id', 'Specific task ID of the fork test to run.').setAction(test);

export default {
  mocha: {
    timeout: 600000,
  },
  solidity: {
    compilers: hardhatBaseConfig.compilers,
    overrides: { ...hardhatBaseConfig.overrides(name) },
  },
  paths: {
    sources: './tasks',
  },
  warnings: hardhatBaseConfig.warnings,
};
