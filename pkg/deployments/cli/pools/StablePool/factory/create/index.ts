import { network } from 'hardhat';
import prompts from 'prompts';
import { BigNumber } from 'ethers';

import { save } from '../../../../../src/utils';
import { Cli, Output } from '../../../../types';

import create from './create';
import { StablePoolFactoryCreateParameters } from './types';

const StablePoolCreateCli: Cli = async ({ environment, parentCli }) => {
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

  const { token0 } = await prompts({
    type: 'text',
    name: 'token0',
    message: 'token0',
  });

  const { token1 } = await prompts({
    type: 'text',
    name: 'token1',
    message: 'token1',
  });

  const tokens = [token0, token1].sort();

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
  const { amplificationParameter } = await prompts({
    type: 'number',
    name: 'amplificationParameter',
    message: 'amplificationParameter',
  });

  const { owner } = await prompts({
    type: 'text',
    name: 'owner',
    message: 'owner',
  });
  const output = await create({
    name,
    symbol,
    tokens,
    amplificationParameter: BigNumber.from(amplificationParameter),
    swapFeePercentage: BigNumber.from(swapFeePercentageTransform(swapFeePercentage)),
    owner,
  });

  if (output) {
    save<Output<StablePoolFactoryCreateParameters, string>>(output, symbol, __dirname, network.name);
  }
};

export default StablePoolCreateCli;
