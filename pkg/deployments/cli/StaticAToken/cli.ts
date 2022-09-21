import prompts from 'prompts';
import { Cli } from '../types';

import depositCli from './deposit/cli';

const staticATokenCli: Cli = async () => {
  const { address } = await prompts({
    type: 'text',
    name: 'address',
    message: 'address',
  });

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'Select action',
    choices: [
      { title: 'deposit', value: 'deposit' },
      { title: 'withdraw', value: 'withdraw' },
    ],
  });

  switch (action) {
    case 'deposit':
      await depositCli(address);
      break;
    case 'withdraw':
      break;
  }
};

export default staticATokenCli;
