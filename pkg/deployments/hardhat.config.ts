import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import 'hardhat-local-networks-config-plugin';

import '@balancer-labs/v2-common/setupTests';

import { task, types } from 'hardhat/config';
import { TASK_TEST } from 'hardhat/builtin-tasks/task-names';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Contract } from 'ethers';
import { Interface } from 'ethers/lib/utils';

import path from 'path';
import { existsSync, readdirSync, statSync } from 'fs';

import { checkArtifact, extractArtifact } from './src/artifact';
import test from './src/test';
import Task, { TaskMode } from './src/task';
import Verifier from './src/verifier';
import { Logger } from './src/logger';

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

      await new Task(args.id, TaskMode.READ_ONLY, hre.network.name, verifier).verify(
        args.name,
        args.address,
        args.args
      );
    }
  );

task('extract-artifacts', `Extract contract artifacts from their build-info`)
  .addOptionalParam('id', 'Specific task ID')
  .setAction(async (args: { id?: string; verbose?: boolean }) => {
    Logger.setDefaults(false, args.verbose || false);

    if (args.id) {
      const task = new Task(args.id, TaskMode.READ_ONLY);
      extractArtifact(task);
    } else {
      const taskDirectory = path.resolve(__dirname, './tasks');

      for (const taskID of readdirSync(taskDirectory)) {
        const task = new Task(taskID, TaskMode.READ_ONLY);
        extractArtifact(task);
      }
    }
  });

task('check-deployments', `Check that all tasks' deployments correspond to their build-info and inputs`)
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
        const outputDir = path.resolve(taskDirectory, taskID, 'output');
        if (existsSync(outputDir) && statSync(outputDir).isDirectory()) {
          const outputFiles = readdirSync(outputDir);
          if (outputFiles.some((outputFile) => outputFile.includes(hre.network.name))) {
            // Not all tasks have outputs for all networks, so we skip those that don't
            await new Task(taskID, TaskMode.CHECK, hre.network.name).run(args);
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
      const taskDirectory = path.resolve(__dirname, './tasks');

      for (const taskID of readdirSync(taskDirectory)) {
        const task = new Task(taskID, TaskMode.READ_ONLY);
        checkArtifact(task);
      }
    }
  });

task('action-ids', `Print the action IDs for a particular contract`)
  .addParam('id', 'Specific task ID')
  .addParam('name', 'Contract name')
  .addOptionalParam('address', 'Contract address')
  .setAction(
    async (args: { id: string; name: string; address?: string; verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
      Logger.setDefaults(false, args.verbose || false);

      const task = new Task(args.id, TaskMode.READ_ONLY, hre.network.name);
      const artifact = task.artifact(args.name);

      const contractInterface = new Interface(artifact.abi as any);
      const contractFunctions = Object.entries(contractInterface.functions).filter(([, func]) =>
        ['nonpayable', 'payable'].includes(func.stateMutability)
      );
      // Not all contracts use the Authorizer directly for authentication.
      // Only if it has the `getActionId` function does it use the Authorizer directly.
      // Contracts without this function either are permissionless or use another method such as the AuthorizerAdaptor.
      const contractIsAuthorizerAware = Object.values(contractInterface.functions).some(
        (func) => func.name === 'getActionId'
      );
      if (contractIsAuthorizerAware) {
        let contract: Contract;
        if (args.address) {
          contract = await task.instanceAt(args.name, args.address);
        } else {
          contract = await task.deployedInstance(args.name);
        }

        for (const [signature, contractFunction] of contractFunctions) {
          const functionSelector = Interface.getSighash(contractFunction);
          console.log(`${signature}: ${await contract.getActionId(functionSelector)}`);
        }
      } else {
        const adaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, hre.network.name);
        const authorizerAdaptor = await adaptorTask.deployedInstance('AuthorizerAdaptor');

        console.log('This contract does not use the Authorizer for authentication');
        console.log('We assume that you are calling these functions through the AuthorizerAdaptor');
        console.log('');

        for (const [signature, contractFunction] of contractFunctions) {
          const functionSelector = Interface.getSighash(contractFunction);
          console.log(`${signature}: ${await authorizerAdaptor.getActionId(functionSelector)}`);
        }
      }
    }
  );

task(TASK_TEST)
  .addOptionalParam('fork', 'Optional network name to be forked block number to fork in case of running fork tests.')
  .addOptionalParam('blockNumber', 'Optional block number to fork in case of running fork tests.', undefined, types.int)
  .setAction(test);

export default {
  mocha: {
    timeout: 600000,
  },
};
