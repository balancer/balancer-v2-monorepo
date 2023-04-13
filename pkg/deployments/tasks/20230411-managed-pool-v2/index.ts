import { getContractDeploymentTransactionHash, saveContractDeploymentTransactionHash } from '../../src/network';
import Task, { TaskMode } from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ManagedPoolDeployment } from './input';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ManagedPoolDeployment;

  const addRemoveTokenLib = await task.deployAndVerify('ManagedPoolAddRemoveTokenLib', [], from, force);
  const circuitBreakerLib = await task.deployAndVerify('CircuitBreakerLib', [], from, force);
  const libs = { CircuitBreakerLib: circuitBreakerLib.address };
  const ammLib = await task.deployAndVerify('ManagedPoolAmmLib', [], from, force, libs);

  const args = [
    input.Vault,
    input.ProtocolFeePercentagesProvider,
    input.FactoryVersion,
    input.PoolVersion,
    input.InitialPauseWindowDuration,
    input.BufferPeriodDuration,
  ];

  const factory = await task.deployAndVerify('ManagedPoolFactory', args, from, force, {
    CircuitBreakerLib: circuitBreakerLib.address,
    ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
    ManagedPoolAmmLib: ammLib.address,
  });

  if (task.mode === TaskMode.LIVE) {
    // We also create a Pool using the factory and verify it, to let us compute their action IDs and so that future
    // Pools are automatically verified. We however don't run any of this code in CHECK mode, since we don't care about
    // the contracts deployed here. The action IDs will be checked to be correct via a different mechanism.
    const newManagedPoolParams = {
      name: 'DO NOT USE - Mock Managed Pool',
      symbol: 'TEST',
      assetManagers: [ZERO_ADDRESS, ZERO_ADDRESS],
    };

    const newManagedPoolSettings = {
      tokens: [input.WETH, input.BAL].sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      }),
      normalizedWeights: [fp(0.8), fp(0.2)],
      swapFeePercentage: bn(1e12),
      swapEnabledOnStart: true,
      mustAllowlistLPs: false,
      managementAumFeePercentage: fp(0.5),
      aumFeeId: 2,
    };

    const newManagedPoolConfig = {
      vault: input.Vault,
      protocolFeeProvider: input.ProtocolFeePercentagesProvider,
      weightedMath: await factory.getWeightedMath(),
      recoveryModeHelper: await factory.getRecoveryModeHelper(),
      pauseWindowDuration: undefined,
      bufferPeriodDuration: undefined,
      version: input.PoolVersion,
    };
    // The pauseWindowDuration and bufferPeriodDuration will be filled in later, but we need to declare them here to
    // appease the type system. Those are constructor arguments, but automatically provided by the factory.
    const mockPoolArgs = {
      params: newManagedPoolParams,
      config: newManagedPoolConfig,
      settings: newManagedPoolSettings,
      owner: ZERO_ADDRESS,
      salt: ZERO_BYTES32,
    };

    // This mimics the logic inside task.deploy
    if (force || !task.output({ ensure: false })['MockManagedPool']) {
      const poolCreationReceipt = await (
        await factory.create(mockPoolArgs.params, mockPoolArgs.settings, mockPoolArgs.owner, mockPoolArgs.salt)
      ).wait();
      const event = expectEvent.inReceipt(poolCreationReceipt, 'PoolCreated');
      const mockPoolAddress = event.args.pool;

      await saveContractDeploymentTransactionHash(mockPoolAddress, poolCreationReceipt.transactionHash, task.network);
      await task.save({ MockManagedPool: mockPoolAddress });
    }

    const mockPool = await task.instanceAt('ManagedPool', task.output()['MockManagedPool']);

    // In order to verify the Pool's code, we need to complete its constructor arguments by computing the factory
    // provided arguments (pause durations).

    // The durations require knowing when the Pool was created, so we look for the timestamp of its creation block.
    const txHash = await getContractDeploymentTransactionHash(mockPool.address, task.network);
    const tx = await ethers.provider.getTransactionReceipt(txHash);
    const poolCreationBlock = await ethers.provider.getBlock(tx.blockNumber);

    // With those and the period end times, we can compute the durations.
    const { pauseWindowEndTime, bufferPeriodEndTime } = await mockPool.getPausedState();
    mockPoolArgs.config.pauseWindowDuration = pauseWindowEndTime.sub(poolCreationBlock.timestamp);
    mockPoolArgs.config.bufferPeriodDuration = bufferPeriodEndTime
      .sub(poolCreationBlock.timestamp)
      .sub(mockPoolArgs.config.pauseWindowDuration);

    // We are now ready to verify the Pool
    await task.verify('ManagedPool', mockPool.address, [
      mockPoolArgs.params,
      mockPoolArgs.config,
      mockPoolArgs.settings,
      mockPoolArgs.owner,
    ]);
  }

  const math = await factory.getWeightedMath();
  await task.verify('ExternalWeightedMath', math, []);
};
