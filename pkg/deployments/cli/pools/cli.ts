import prompts from 'prompts';

import WeightedPoolCli from './WeightedPool/cli';
import StablePoolCli from './StablePool/cli';
import MetaStablePoolCli from './MetaStablePool/cli';
import AaveLinearPoolCli from './AaveLinearPool/cli';
import StablePhantomPoolCli from './StablePhantomPool/cli';
import { Cli } from '../types';

const poolsCli: Cli = async (cliProps) => {
  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'Select action',
    choices: [
      { title: 'StablePool', value: 'StablePool' },
      { title: 'StablePhantomPool', value: 'StablePhantomPool' },
      { title: 'WeightedPool', value: 'WeightedPool' },
      { title: 'MetaStablePool', value: 'MetaStablePool' },
      { title: 'AaveLinearPool', value: 'AaveLinearPool' },
    ],
  });

  switch (action) {
    case 'StablePool':
      await StablePoolCli(cliProps);
      break;
    case 'StablePhantomPool':
      await StablePhantomPoolCli(cliProps);
      break;
    case 'MetaStablePool':
      await MetaStablePoolCli(cliProps);
      break;
    case 'WeightedPool':
      await WeightedPoolCli(cliProps);
      break;
    case 'AaveLinearPool':
      await AaveLinearPoolCli(cliProps);
      break;
  }
};

export default poolsCli;