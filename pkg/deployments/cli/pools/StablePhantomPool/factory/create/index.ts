import prompts from 'prompts';
import { network } from 'hardhat';
import { BigNumber } from 'ethers';

import create from './create';

import { save } from '../../../../../src/utils';
import { Cli, Output } from '../../../../types';

import { StablePhantomPoolFactoryCreateParameters } from './types';

const StablePhantomPoolCreateCli: Cli = async ({ environment, parentCli }) => {
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

  const tokensDesc: { token: string; rateProvider: string; priceRateCacheDuration: number }[] = [];

  while (true) {
    const { addToken } = await prompts({
      type: 'confirm',
      name: 'addToken',
      message: 'add token',
    });
    if (!addToken) break;

    const { token } = await prompts({
      type: 'text',
      name: 'token',
      message: 'token',
    });
    const { rateProvider } = await prompts({
      type: 'text',
      name: 'rateProvider',
      message: 'rateProvider',
    });
    const { priceRateCacheDuration } = await prompts({
      type: 'text',
      name: 'priceRateCacheDuration',
      message: 'priceRateCacheDuration',
    });

    tokensDesc.push({
      token,
      rateProvider,
      priceRateCacheDuration,
    });
  }
  const sortedTokensDesc = tokensDesc.sort((a, b) => {
    if (a.token === b.token) {
      return 0;
    } else {
      return a.token < b.token ? -1 : 1;
    }
  });
  const tokens = sortedTokensDesc.map(({ token }) => token);
  const rateProviders = sortedTokensDesc.map(({ rateProvider }) => rateProvider);
  const priceRateCacheDuration = sortedTokensDesc.map(({ priceRateCacheDuration }) => priceRateCacheDuration);

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
    rateProviders,
    priceRateCacheDuration,
    amplificationParameter: BigNumber.from(amplificationParameter),
    swapFeePercentage: BigNumber.from(swapFeePercentageTransform(swapFeePercentage)),
    owner,
  });

  if (output) {
    save<Output<StablePhantomPoolFactoryCreateParameters, string>>(output, symbol, __dirname, network.name);
  }
};

export default StablePhantomPoolCreateCli;
