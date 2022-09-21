import prompts from 'prompts';

import { Cli } from '../../../types';
import StablePoolCreateCli from './create';

const StablePoolFactoryCli: Cli = async ({ environment, parentCli }) => {
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
      await StablePoolCreateCli({ environment: environment, parentCli: StablePoolFactoryCli });
      break;
  }

  return StablePoolFactoryCli({ environment, parentCli });
};

export default StablePoolFactoryCli;
