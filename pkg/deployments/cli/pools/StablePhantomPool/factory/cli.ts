import prompts from 'prompts';

import StablePhantomPoolCreateCli from './create';

import { Cli } from '../../../types';

const StablePhantomPoolFactoryCli: Cli = async ({ environment, parentCli }) => {
  const choices = [{ title: 'create', value: 'create' }];

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
    case 'create':
      await StablePhantomPoolCreateCli({ environment: environment, parentCli: StablePhantomPoolFactoryCli });
      break;
  }

  return StablePhantomPoolFactoryCli({ environment, parentCli });
};

export default StablePhantomPoolFactoryCli;
