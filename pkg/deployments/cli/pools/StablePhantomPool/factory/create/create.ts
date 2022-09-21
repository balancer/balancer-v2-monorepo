import { ethers, network } from 'hardhat';
import { StablePhantomPoolFactory } from '@balancer-labs/typechain';

import { Output } from '../../../../types';

import input from '../input';
import { StablePhantomPoolFactoryCreateParameters } from './types';

import StablePhantomPoolFactoryAbi from '../abi/StablePhantomPoolFactory.json';

async function create({
  name,
  symbol,
  tokens,
  rateProviders,
  priceRateCacheDuration,
  amplificationParameter,
  swapFeePercentage,
  owner,
}: StablePhantomPoolFactoryCreateParameters): Promise<
  Output<StablePhantomPoolFactoryCreateParameters, string> | undefined
> {
  const { StablePhantomPoolTask } = input;
  const { StablePhantomPoolFactory: StablePhantomPoolFactoryAddress } = StablePhantomPoolTask.output({
    network: network.name,
  });
  console.log('StablePhantomPoolFactoryAddress', StablePhantomPoolFactoryAddress);
  console.table({
    name,
    symbol,
    tokens,
    rateProviders: rateProviders,
    priceRateCacheDuration: priceRateCacheDuration.map((duration) => duration.toString()),
    amplificationParameter: amplificationParameter.toString(),
    swapFeePercentage: swapFeePercentage.toString(),
    owner,
  });

  const StablePhantomPoolFactoryContract = (await ethers.getContractAt(
    StablePhantomPoolFactoryAbi,
    StablePhantomPoolFactoryAddress
  )) as StablePhantomPoolFactory;

  try {
    const result = await StablePhantomPoolFactoryContract.callStatic.create(
      name,
      symbol,
      tokens,
      amplificationParameter,
      rateProviders,
      priceRateCacheDuration,
      swapFeePercentage,
      owner
    );
    console.log(result);
  } catch (error) {
    console.log(JSON.stringify(error, null, 2));
    process.exit(0);
  }
  const transaction = await StablePhantomPoolFactoryContract.create(
    name,
    symbol,
    tokens,
    amplificationParameter,
    rateProviders,
    priceRateCacheDuration,
    swapFeePercentage,
    owner
  );
  const receipt = await transaction.wait(2);

  const poolCreatedEvents = receipt?.events?.filter((e) => e.event === 'PoolCreated');
  if (poolCreatedEvents && poolCreatedEvents.length > 0) {
    const poolAddress = poolCreatedEvents[0].args?.pool;

    const output: Output<StablePhantomPoolFactoryCreateParameters, string> = {
      transaction: {
        hash: transaction.hash,
        blockNumber: transaction.blockNumber,
      },
      data: {
        StablePhantomPoolFactory: {
          create: {
            input: {
              name,
              symbol,
              tokens,
              rateProviders: rateProviders,
              priceRateCacheDuration: priceRateCacheDuration.map((duration) => duration.toString()),
              amplificationParameter: amplificationParameter.toString(),
              swapFeePercentage: swapFeePercentage.toString(),
              owner,
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
