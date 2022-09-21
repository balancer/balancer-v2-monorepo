import { ethers, network } from 'hardhat';
import { StablePoolFactory } from '@balancer-labs/typechain';

import { Output } from '../../../../types';

import input from '../input';
import StablePoolFactoryAbi from '../abi/StablePoolFactory.json';

import { StablePoolFactoryCreateParameters } from './types';

async function create({
  name,
  symbol,
  tokens,
  amplificationParameter,
  swapFeePercentage,
  owner,
}: StablePoolFactoryCreateParameters): Promise<Output<StablePoolFactoryCreateParameters, string> | undefined> {
  const { StablePoolTask } = input;
  const { StablePoolFactory: StablePoolFactoryAddress } = StablePoolTask.output({
    network: network.name,
  });

  const StablePoolFactoryContract = (await ethers.getContractAt(
    StablePoolFactoryAbi,
    StablePoolFactoryAddress
  )) as StablePoolFactory;

  const transaction = await StablePoolFactoryContract.create(
    name,
    symbol,
    tokens,
    amplificationParameter,
    swapFeePercentage,
    owner
  );
  const receipt = await transaction.wait(2);

  const poolCreatedEvents = receipt?.events?.filter((e) => e.event === 'PoolCreated');
  if (poolCreatedEvents && poolCreatedEvents.length > 0) {
    const poolAddress = poolCreatedEvents[0].args?.pool;

    const output: Output<StablePoolFactoryCreateParameters, string> = {
      transaction: {
        hash: transaction.hash,
        blockNumber: transaction.blockNumber,
      },
      data: {
        StablePoolFactory: {
          create: {
            input: {
              name,
              symbol,
              tokens,
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
