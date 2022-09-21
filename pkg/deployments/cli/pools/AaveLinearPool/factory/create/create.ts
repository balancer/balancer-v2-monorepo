import { ethers, network } from 'hardhat';
import { AaveLinearPoolFactory } from '@balancer-labs/typechain';

import input from '../input';

import AaveLinearPoolFactoryAbi from '../abi/AaveLinearPoolFactory.json';
import { AaveLinearPoolFactoryCreateParameters } from './types';
import { Output } from '../../../../types';

async function create({
  name,
  symbol,
  mainToken,
  wrappedToken,
  upperTarget,
  swapFeePercentage,
  owner,
}: AaveLinearPoolFactoryCreateParameters): Promise<Output<AaveLinearPoolFactoryCreateParameters, string> | undefined> {
  const { AAVELinearPoolTask } = input;
  const { AaveLinearPoolFactory: AaveLinearPoolFactoryAddress } = AAVELinearPoolTask.output({
    network: network.name,
  });

  console.log((await ethers.getSigners()).map((signer) => signer.address));
  console.log('AaveLinearPoolFactory', AaveLinearPoolFactoryAddress);

  const AaveLinearPoolFactoryContract = (await ethers.getContractAt(
    AaveLinearPoolFactoryAbi,
    AaveLinearPoolFactoryAddress
  )) as AaveLinearPoolFactory;

  console.log(name, symbol, mainToken, wrappedToken, upperTarget.toString(), swapFeePercentage.toString(), owner);

  const transaction = await AaveLinearPoolFactoryContract.create(
    name,
    symbol,
    mainToken,
    wrappedToken,
    upperTarget,
    swapFeePercentage,
    owner
  );

  const receipt = await transaction.wait(2);

  const poolCreatedEvents = receipt?.events?.filter((e) => e.event === 'PoolCreated');
  if (poolCreatedEvents && poolCreatedEvents.length > 0) {
    const poolAddress = poolCreatedEvents[0].args?.pool;

    const output: Output<AaveLinearPoolFactoryCreateParameters, string> = {
      transaction: {
        hash: transaction.hash,
        blockNumber: transaction.blockNumber,
      },
      data: {
        AAVELinearPoolFactory: {
          create: {
            input: {
              name,
              symbol,
              mainToken,
              wrappedToken,
              upperTarget: upperTarget.toString(),
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
