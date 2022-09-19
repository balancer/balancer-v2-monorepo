import { program } from 'commander';

import { Network } from '../src/types';

import setupScriptRunEnvironment from './scriptRunEnvirionment';
import selectNetworkCommand from './config.command';

import WeightedPoolFactoryCli from './WeightedPoolFactory/cli';
import StablePoolFactoryCli from './StablePoolFactory/cli';
import MetaStablePoolFactory from './MetaStablePoolFactory/cli';
import AaveLinearPoolFactory from './AaveLinearPoolFactory/cli';
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
        { title: 'MetaStablePoolFactory', value: 'MetaStablePoolFactory' },
        { title: 'AaveLinearPoolFactory', value: 'AaveLinearPoolFactory' },
      ],
    });

    switch (action) {
      case 'StablePoolFactory':
        await StablePoolFactoryCli({ environment: scriptRunEnvironment });
        break;
      case 'MetaStablePoolFactory':
        await MetaStablePoolFactory({ environment: scriptRunEnvironment });
        break;
      case 'WeightedPoolFactory':
        await WeightedPoolFactoryCli({ environment: scriptRunEnvironment });
        break;
      case 'AaveLinearPoolFactory':
        await AaveLinearPoolFactory({ environment: scriptRunEnvironment });
        break;
    }
  });

program.parse();
