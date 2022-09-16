import { program } from 'commander';

import { Network } from '../src/types';

import setupScriptRunEnvironment from './scriptRunEnvirionment';
import selectNetworkCommand from './config.command';

import WeightedPoolFactoryCli from './WeightedPoolFactory/cli';
import StablePoolFactoryCli from './StablePoolFactory/cli';
import prompts from 'prompts';

program
  .name('cli')
  .description('CLI to manage Hadouken Swap contracts')
  .action(async () => {
    const network = await selectNetworkCommand();
    const scriptRunEnvironment = await setupScriptRunEnvironment(network as Network);

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Select action',
      choices: [
        { title: 'StablePoolFactory', value: 'StablePoolFactory' },
        { title: 'WeightedPoolFactory', value: 'WeightedPoolFactory' },
      ],
    });

    switch (action) {
      case 'StablePoolFactory':
        await StablePoolFactoryCli({ environment: scriptRunEnvironment });
        break;
      case 'WeightedPoolFactory':
        await WeightedPoolFactoryCli({ environment: scriptRunEnvironment });
        break;
    }
  });

program.parse();
