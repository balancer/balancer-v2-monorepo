import prompts from 'prompts';

import { Cli } from '../../types';

import AaveLinearPoolFactoryCli from './factory/cli';
import createGetterMethodsCli from '../../utils/createGetterMethodsCli';

import AaveLinearPoolAbi from './abi/AaveLinearPool.json';

const AaveLinearPoolCli: Cli = async ({ environment, parentCli }) => {
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
      await AaveLinearPoolFactoryCli({ environment: environment, parentCli: AaveLinearPoolCli });
      break;
    case 'pool getters': {
      const { poolAddress } = await prompts({
        type: 'text',
        name: 'poolAddress',
        message: 'pool address',
      });

      const getterMethodsCli = createGetterMethodsCli(AaveLinearPoolAbi);
      await getterMethodsCli(poolAddress, {
        environment: environment,
        parentCli: AaveLinearPoolCli,
      });

      break;
    }
  }

  return AaveLinearPoolCli({ environment, parentCli });
};

export default AaveLinearPoolCli;
