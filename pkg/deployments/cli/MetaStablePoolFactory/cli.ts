import prompts from 'prompts';

import { Cli } from '../types';
import MetaStablePoolCreateCli from './create';

const MetaStablePoolFactoryCli: Cli = async ({ environment, parentCli }) => {
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
      await MetaStablePoolCreateCli({ environment: environment, parentCli: MetaStablePoolFactoryCli });
      break;
  }

  return MetaStablePoolFactoryCli({ environment, parentCli });
};

export default MetaStablePoolFactoryCli;
