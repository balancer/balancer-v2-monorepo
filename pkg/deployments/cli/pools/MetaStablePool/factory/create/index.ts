import prompts from 'prompts';
import { BigNumber } from 'ethers';

import { Cli, Output } from '../../../../types';
import { save } from '../../../../../src/utils';

import create from './create';
import { MetaStablePoolFactoryCreateParameters } from './types';
import { network } from 'hardhat';

const MetaStablePoolCreateCli: Cli = async ({ environment, parentCli }) => {
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
  const { rateProvider0 } = await prompts({
    type: 'text',
    name: 'rateProvider0',
    message: 'rateProvider0',
  });
  const { priceRateCacheDuration0 } = await prompts({
    type: 'text',
    name: 'priceRateCacheDuration0',
    message: 'priceRateCacheDuration0',
  });

  const { token1 } = await prompts({
    type: 'text',
    name: 'token1',
    message: 'token1',
  });
  const { rateProvider1 } = await prompts({
    type: 'text',
    name: 'rateProvider1',
    message: 'rateProvider1',
  });
  const { priceRateCacheDuration1 } = await prompts({
    type: 'number',
    name: 'priceRateCacheDuration1',
    message: 'priceRateCacheDuration1',
  });
  const tokensInputs = [
    [token0, rateProvider0, priceRateCacheDuration0],
    [token1, rateProvider1, priceRateCacheDuration1],
  ].sort((a, b) => {
    if (a[0] === b[0]) {
      return 0;
    } else {
      return a[0] < b[0] ? -1 : 1;
    }
  });
  const tokens = tokensInputs.map((tokenInput) => tokenInput[0]);
  const rateProviders = tokensInputs.map((tokenInput) => tokenInput[1]);
  const priceRateCacheDuration = tokensInputs.map((tokenInput) => tokenInput[2]);

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

  const { delegate } = await prompts({
    type: 'text',
    name: 'delegate',
    message: 'delegate',
  });
  const output = await create({
    name,
    symbol,
    tokens,
    amplificationParameter: BigNumber.from(amplificationParameter),
    rateProviders,
    priceRateCacheDuration,
    swapFeePercentage: BigNumber.from(swapFeePercentageTransform(swapFeePercentage)),
    delegate,
  });

  if (output) {
    save<Output<MetaStablePoolFactoryCreateParameters, string>>(output, symbol, __dirname, network.name);
  }
};

export default MetaStablePoolCreateCli;
