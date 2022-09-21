import { program } from 'commander';
import prompts from 'prompts';

import { Network } from '../src/types';

import setupScriptRunEnvironment from './scriptRunEnvirionment';
import selectNetworkCommand from './config.command';

import poolsCli from './pools/cli';
import vaultCli from './Vault/cli';

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
        { title: 'pools', value: 'pools' },
        { title: 'vault', value: 'vault' },
      ],
    });

    switch (action) {
      case 'pools':
        await poolsCli({ environment: scriptRunEnvironment });
        break;
      case 'vault':
        await vaultCli({ environment: scriptRunEnvironment });
        break;
    }
  });

program.parse();
