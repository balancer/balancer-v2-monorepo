import prompts from 'prompts';

import { Cli } from '../../../types';
import AaveLinearPoolCreateCli from './create';

const AaveLinearPoolFactoryCli: Cli = async ({ environment, parentCli }) => {
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
      await AaveLinearPoolCreateCli({ environment: environment, parentCli: AaveLinearPoolFactoryCli });
      break;
  }

  return AaveLinearPoolFactoryCli({ environment, parentCli });
};

export default AaveLinearPoolFactoryCli;
