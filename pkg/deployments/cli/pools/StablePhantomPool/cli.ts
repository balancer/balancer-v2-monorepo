import prompts from 'prompts';

import { Cli } from '../../types';

import poolFactoryCli from './factory/cli';
import createGetterMethodsCli from '../../utils/createGetterMethodsCli';

import poolAbi from './abi/pool.json';

const poolCli: Cli = async ({ environment, parentCli }) => {
  const choices = [
    { title: 'factory', value: 'factory' },
    { title: 'pool getters', value: 'pool getters' },
  ];

  const { action } = await prompts(
    {
      type: 'select',
      name: 'action',
      message: 'Select action',
      choices,
    },
    {
      onCancel: () => {
        return parentCli ? parentCli({ environment }) : process.exit(0);
      },
    }
  );

  switch (action) {
    case 'factory':
      await poolFactoryCli({ environment: environment, parentCli: poolCli });
      break;
    case 'pool getters': {
      const { poolAddress } = await prompts({
        type: 'text',
        name: 'poolAddress',
        message: 'pool address',
      });

      const getterMethodsCli = createGetterMethodsCli(poolAbi);
      await getterMethodsCli(poolAddress, {
        environment: environment,
        parentCli: poolCli,
      });

      break;
    }
  }

  return poolCli({ environment, parentCli });
};

export default poolCli;
