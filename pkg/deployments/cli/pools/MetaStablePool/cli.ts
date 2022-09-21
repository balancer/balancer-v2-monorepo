import prompts from 'prompts';

import { Cli } from '../../types';

import MetaStablePoolFactoryCli from './factory/cli';
import createGetterMethodsCli from '../utils/createPoolGetterMethodsCli';

import MetaStablePoolAbi from './abi/MetaStablePool.json';

const MetaStablePoolCli: Cli = async ({ environment, parentCli }) => {
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
      await MetaStablePoolFactoryCli({ environment: environment, parentCli: MetaStablePoolCli });
      break;
    case 'pool getters': {
      const { poolAddress } = await prompts({
        type: 'text',
        name: 'poolAddress',
        message: 'pool address',
      });

      const getterMethodsCli = createGetterMethodsCli(MetaStablePoolAbi);
      await getterMethodsCli(poolAddress, {
        environment: environment,
        parentCli: MetaStablePoolCli,
      });

      break;
    }
  }

  return MetaStablePoolCli({ environment, parentCli });
};

export default MetaStablePoolCli;
