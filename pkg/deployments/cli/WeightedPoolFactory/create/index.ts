import prompts from 'prompts';
import { BigNumber } from 'ethers';

import { Cli, Output } from '../../types';
import create from './create';
import { save } from '../../../src/utils';
import { WeightedPoolFactoryCreateParameters } from './types';
import { network } from 'hardhat';

const WeghtedPoolCreateCli: Cli = async ({ environment, parentCli }) => {
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
  const { weight0 } = await prompts({
    type: 'number',
    name: 'weight0',
    message: 'weight0',
  });

  const { token1 } = await prompts({
    type: 'text',
    name: 'token1',
    message: 'token1',
  });
  const { weight1 } = await prompts({
    type: 'number',
    name: 'weight1',
    message: 'weight1',
  });

  const weightedTokens = [
    [token0, weight0],
    [token1, weight1],
  ].sort((a, b) => {
    if (a[0] === b[0]) {
      return 0;
    } else {
      return a[0] < b[0] ? -1 : 1;
    }
  });

  const tokens = weightedTokens.map((weightedToken) => weightedToken[0]);
  const weights = weightedTokens
    .map((weightedToken) => weightedToken[1])
    .map((weight) => BigNumber.from(10).pow(18).div(100).mul(weight));

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

  const { delegate } = await prompts({
    type: 'text',
    name: 'delegate',
    message: 'delegate',
  });
  const output = await create({
    name,
    symbol,
    tokens,
    weights,
    swapFeePercentage: BigNumber.from(swapFeePercentageTransform(swapFeePercentage)),
    delegate,
  });

  if (output) {
    save<Output<WeightedPoolFactoryCreateParameters, string>>(output, symbol, __dirname, network.name);
  }
};

export default WeghtedPoolCreateCli;
