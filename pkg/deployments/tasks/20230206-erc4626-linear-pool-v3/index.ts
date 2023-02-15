import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import Task, { TaskMode } from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ERC4626LinearPoolDeployment } from './input';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { ethers } from 'hardhat';
import { getContractDeploymentTransactionHash, saveContractDeploymentTransactionHash } from '../../src';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ERC4626LinearPoolDeployment;
  const args = [
    input.Vault,
    input.ProtocolFeePercentagesProvider,
    input.BalancerQueries,
    input.FactoryVersion,
    input.PoolVersion,
    input.InitialPauseWindowDuration,
    input.BufferPeriodDuration,
  ];

  const factory = await task.deployAndVerify('ERC4626LinearPoolFactory', args, from, force);

  if (task.mode === TaskMode.LIVE) {
    // We also create a Pool using the factory and verify it, to let us compute their action IDs and so that future
    // Pools are automatically verified. We however don't run any of this code in CHECK mode, since we don't care about
    // the contracts deployed here. The action IDs will be checked to be correct via a different mechanism.

    // ERC4626LinearPools require an ERC4626 Token
    const mockErc4626TokenArgs = ['DO NOT USE - Mock ERC4626 Token', 'TEST', 18, input.WETH];
    const mockErc4626Token = await task.deployAndVerify('MockERC4626Token', mockErc4626TokenArgs, from, force);

    // The assetManager, pauseWindowDuration and bufferPeriodDuration will be filled in later, but we need to declare
    // them here to appease the type system. Those are constructor arguments, but automatically provided by the factory.
    const mockPoolArgs = {
      vault: input.Vault,
      name: 'DO NOT USE - Mock Linear Pool',
      symbol: 'TEST',
      mainToken: input.WETH,
      wrappedToken: mockErc4626Token.address,
      assetManager: undefined,
      upperTarget: 0,
      pauseWindowDuration: undefined,
      bufferPeriodDuration: undefined,
      swapFeePercentage: bn(1e12),
      owner: ZERO_ADDRESS,
      version: input.PoolVersion,
    };

    // This mimics the logic inside task.deploy
    if (force || !task.output({ ensure: false })['MockERC4626LinearPool']) {
      const PROTOCOL_ID = 0;

      const poolCreationReceipt = await (
        await factory.create(
          mockPoolArgs.name,
          mockPoolArgs.symbol,
          mockPoolArgs.mainToken,
          mockPoolArgs.wrappedToken,
          mockPoolArgs.upperTarget,
          mockPoolArgs.swapFeePercentage,
          mockPoolArgs.owner,
          PROTOCOL_ID
        )
      ).wait();
      const event = expectEvent.inReceipt(poolCreationReceipt, 'PoolCreated');
      const mockPoolAddress = event.args.pool;

      await saveContractDeploymentTransactionHash(mockPoolAddress, poolCreationReceipt.transactionHash, task.network);
      await task.save({ MockERC4626LinearPool: mockPoolAddress });
    }

    const mockPool = await task.instanceAt('ERC4626LinearPool', task.output()['MockERC4626LinearPool']);

    // In order to verify the Pool's code, we need to complete its constructor arguments by computing the factory
    // provided arguments (asset manager and pause durations).

    // The asset manager is found by querying the Vault
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, task.network);
    const vault = await vaultTask.deployedInstance('Vault');

    const { assetManager: assetManagerAddress } = await vault.getPoolTokenInfo(await mockPool.getPoolId(), input.WETH);
    mockPoolArgs.assetManager = assetManagerAddress;

    // The durations require knowing when the Pool was created, so we look for the timestamp of its creation block.
    const txHash = await getContractDeploymentTransactionHash(mockPool.address, task.network);
    const tx = await ethers.provider.getTransactionReceipt(txHash);
    const poolCreationBlock = await ethers.provider.getBlock(tx.blockNumber);

    // With those and the period end times, we can compute the durations.
    const { pauseWindowEndTime, bufferPeriodEndTime } = await mockPool.getPausedState();
    mockPoolArgs.pauseWindowDuration = pauseWindowEndTime.sub(poolCreationBlock.timestamp);
    mockPoolArgs.bufferPeriodDuration = bufferPeriodEndTime
      .sub(poolCreationBlock.timestamp)
      .sub(mockPoolArgs.pauseWindowDuration);

    // We are now ready to verify the Pool
    await task.verify('ERC4626LinearPool', mockPool.address, [mockPoolArgs]);

    // We can also verify the Asset Manager
    await task.verify('ERC4626LinearPoolRebalancer', assetManagerAddress, [input.Vault, input.BalancerQueries]);
  }
};
