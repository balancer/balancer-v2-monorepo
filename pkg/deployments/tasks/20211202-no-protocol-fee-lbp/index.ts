import Task, { TaskMode } from '../../src/task';
import { NoProtocolFeeLiquidityBootstrappingPoolDeployment } from './input';
import { TaskRunOptions } from '../../src/types';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { getContractDeploymentTransactionHash, saveContractDeploymentTransactionHash } from '../../src/network';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as NoProtocolFeeLiquidityBootstrappingPoolDeployment;
  const args = [input.Vault];
  const factory = await task.deployAndVerify('NoProtocolFeeLiquidityBootstrappingPoolFactory', args, from, force);

  if (task.mode === TaskMode.LIVE) {
    // We also create a Pool using the factory and verify it, to let us compute their action IDs and so that future
    // Pools are automatically verified. We however don't run any of this code in CHECK mode, since we don't care about
    // the contracts deployed here. The action IDs will be checked to be correct via a different mechanism.
    const newPoolParams = {
      name: 'DO NOT USE - Mock LiquidityBootstrappingPool Pool',
      symbol: 'TEST',
      tokens: [input.WETH, input.BAL].sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      }),
      weights: [fp(0.8), fp(0.2)],
      swapFeePercentage: bn(1e12),
      swapEnabledOnStart: true,
      owner: ZERO_ADDRESS,
    };

    // This mimics the logic inside task.deploy
    if (force || !task.output({ ensure: false })['MockLiquidityBootstrappingPool']) {
      const poolCreationReceipt = await (
        await factory.create(
          newPoolParams.name,
          newPoolParams.symbol,
          newPoolParams.tokens,
          newPoolParams.weights,
          newPoolParams.swapFeePercentage,
          newPoolParams.owner,
          newPoolParams.swapEnabledOnStart
        )
      ).wait();
      const event = expectEvent.inReceipt(poolCreationReceipt, 'PoolCreated');
      const mockPoolAddress = event.args.pool;

      await saveContractDeploymentTransactionHash(mockPoolAddress, poolCreationReceipt.transactionHash, task.network);
      await task.save({ MockLiquidityBootstrappingPool: mockPoolAddress });
    }

    const mockPool = await task.instanceAt(
      'LiquidityBootstrappingPool',
      task.output()['MockLiquidityBootstrappingPool']
    );

    // In order to verify the Pool's code, we need to complete its constructor arguments by computing the factory
    // provided arguments (pause durations).

    // The durations require knowing when the Pool was created, so we look for the timestamp of its creation block.
    const txHash = await getContractDeploymentTransactionHash(mockPool.address, task.network);
    const tx = await ethers.provider.getTransactionReceipt(txHash);
    const poolCreationBlock = await ethers.provider.getBlock(tx.blockNumber);

    // With those and the period end times, we can compute the durations.
    const { pauseWindowEndTime, bufferPeriodEndTime } = await mockPool.getPausedState();
    const pauseWindowDuration = pauseWindowEndTime.sub(poolCreationBlock.timestamp);
    const bufferPeriodDuration = bufferPeriodEndTime.sub(poolCreationBlock.timestamp).sub(pauseWindowDuration);

    // We are now ready to verify the Pool
    await task.verify('LiquidityBootstrappingPool', mockPool.address, [
      input.Vault,
      newPoolParams.name,
      newPoolParams.symbol,
      newPoolParams.tokens,
      newPoolParams.weights,
      newPoolParams.swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      newPoolParams.owner,
      newPoolParams.swapEnabledOnStart,
    ]);
  }
};
