import prompts from 'prompts';
import { ethers, network } from 'hardhat';
import { Cli } from '../types';

import joinCli from './join/cli';
import swapCli from './swap/cli';

import input from './input';

const vaultCli: Cli = async () => {
  const { Vault: vaultAddress } = input.VaultTask.output({ network: network.name });

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'Select action',
    choices: [
      { title: 'initial join', value: 'initial join' },
      { title: 'swap', value: 'swap' },
    ],
  });

  const { poolAddress } = await prompts({
    type: 'text',
    name: 'poolAddress',
    message: 'pool address',
  });

  switch (action) {
    case 'initial join':
      await joinCli(vaultAddress, poolAddress);
      break;
    case 'swap':
      await swapCli(vaultAddress, poolAddress);
      break;
  }
};

export default vaultCli;
