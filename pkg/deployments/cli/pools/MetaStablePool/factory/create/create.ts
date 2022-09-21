import { ethers, network } from 'hardhat';
import { BigNumber } from 'ethers';
import { MetaStablePoolFactory } from '@balancer-labs/typechain';

import { Output } from '../../../../types';

import input from '../input';
import MetaStablePoolFactoryAbi from '../abi/MetaStablePoolFactory.json';

import { MetaStablePoolFactoryCreateParameters } from './types';

async function create({
  name,
  symbol,
  tokens,
  rateProviders,
  priceRateCacheDuration,
  amplificationParameter,
  swapFeePercentage,
  delegate,
}: MetaStablePoolFactoryCreateParameters): Promise<Output<MetaStablePoolFactoryCreateParameters, string> | undefined> {
  const { MetaStablePoolTask } = input;
  const { MetaStablePoolFactory: MetaStablePoolFactoryAddress } = MetaStablePoolTask.output({
    network: network.name,
  });

  const MetaStablePoolFactoryContract = (await ethers.getContractAt(
    MetaStablePoolFactoryAbi,
    MetaStablePoolFactoryAddress
  )) as MetaStablePoolFactory;

  console.log(
    name,
    symbol,
    tokens,
    amplificationParameter.toString(),
    rateProviders,
    priceRateCacheDuration.map((priceRateCacheDuration) => priceRateCacheDuration.toString()),
    swapFeePercentage.toString(),
    delegate
  );

  const transaction = await MetaStablePoolFactoryContract.create(
    name,
    symbol,
    tokens,
    amplificationParameter,
    rateProviders,
    priceRateCacheDuration,
    swapFeePercentage,
    false,
    delegate,
    {
      gasLimit: 12000000,
      gasPrice: BigNumber.from(90000 * 10 ** 9),
    }
  );
  const receipt = await transaction.wait(2);

  const poolCreatedEvents = receipt?.events?.filter((e) => e.event === 'PoolCreated');
  if (poolCreatedEvents && poolCreatedEvents.length > 0) {
    const poolAddress = poolCreatedEvents[0].args?.pool;

    const output: Output<MetaStablePoolFactoryCreateParameters, string> = {
      transaction: {
        hash: transaction.hash,
        blockNumber: transaction.blockNumber,
      },
      data: {
        MetaStablePoolFactory: {
          create: {
            input: {
              name,
              symbol,
              tokens,
              amplificationParameter: amplificationParameter.toString(),
              rateProviders,
              priceRateCacheDuration: priceRateCacheDuration.map((priceRateCacheDuration) =>
                priceRateCacheDuration.toString()
              ),
              swapFeePercentage: swapFeePercentage.toString(),
              delegate,
            },
            output: poolAddress,
          },
        },
      },
    };

    return output;
  }
}

export default create;
