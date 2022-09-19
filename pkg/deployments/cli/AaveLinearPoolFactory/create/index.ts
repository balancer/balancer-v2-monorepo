import prompts from 'prompts';
import { BigNumber } from 'ethers';

import { Cli, Output } from '../../types';
import create from './create';
import { save } from '../../../src/utils';
import { AaveLinearPoolFactoryCreateParameters } from './types';
import { network } from 'hardhat';

const AaveLinearPoolCreateCli: Cli = async ({ environment, parentCli }) => {
  const { name } = await prompts({
    type: 'text',
    name: 'name',
    message: 'name',
  });
  const { symbol } = await prompts({
    type: 'text',
    name: 'symbol',
    message: 'symbol',
  });

  const { mainToken } = await prompts({
    type: 'text',
    name: 'mainToken',
    message: 'mainToken',
  });

  const { wrappedToken } = await prompts({
    type: 'text',
    name: 'wrappedToken',
    message: 'wrappedToken',
  });

  const swapFeePercentageTransform = (swapFeePercentage: number) =>
    BigNumber.from(swapFeePercentage).mul(BigNumber.from(10).pow(12));

  const { swapFeePercentage } = await prompts({
    type: 'number',
    name: 'swapFeePercentage',
    message: 'swapFeePercentage([1, 10000] -> [0.0001 ,10])',
    validate: (swapFeePercentage) => {
      const swapFeePercentageBN = swapFeePercentageTransform(swapFeePercentage);

      return swapFeePercentageBN.gte(BigNumber.from(10).pow(12)) && swapFeePercentageBN.lte(BigNumber.from(10).pow(17));
    },
  });
  const { upperTarget } = await prompts({
    type: 'number',
    name: 'upperTarget',
    message: 'upperTarget (1e18)',
  });

  const { owner } = await prompts({
    type: 'text',
    name: 'owner',
    message: 'owner',
  });
  const output = await create({
    name,
    symbol,
    mainToken,
    wrappedToken,
    upperTarget: BigNumber.from(upperTarget).mul(BigNumber.from(10).pow(18)),
    swapFeePercentage: BigNumber.from(swapFeePercentageTransform(swapFeePercentage)),
    owner,
  });

  if (output) {
    save<Output<AaveLinearPoolFactoryCreateParameters, string>>(output, symbol, __dirname, network.name);
  }
};

export default AaveLinearPoolCreateCli;
