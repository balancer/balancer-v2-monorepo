import prompts from 'prompts';
import { ERC20__factory } from '@balancer-labs/typechain';

import { Cli } from '../types';

import createGetterMethodsCli from '../utils/createGetterMethodsCli';
import abi from './abi/ERC20.json';
import { ethers } from 'hardhat';
import chalk from 'chalk';

const erc20Cli: Cli = async (cliProps) => {
  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'Select action',
    choices: [
      { title: 'getters', value: 'getters' },
      { title: 'balanceOf', value: 'balanceOf' },
    ],
  });

  const { address } = await prompts({
    type: 'text',
    name: 'address',
    message: 'address',
  });

  switch (action) {
    case 'getters': {
      const getterMethodsCli = createGetterMethodsCli(abi);
      await getterMethodsCli(address, cliProps);

      break;
    }
    case 'balanceOf': {
      const deployer = (await ethers.getSigners())[0];
      const { account } = await prompts({
        type: 'text',
        name: 'account',
        message: 'account',
        initial: deployer.address,
      });

      const erc20Contract = ERC20__factory.connect(address, deployer);
      const balance = await erc20Contract.balanceOf(account);
      console.log(chalk.bgYellow(chalk.black('balance')), chalk.yellow(balance.toString()));
    }
  }
};

export default erc20Cli;
