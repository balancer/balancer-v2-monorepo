import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { setup, rewardsDuration } from './MultiRewardsSharedSetup';

describe('Exiter', () => {
  let lp: SignerWithAddress, mockAssetManager: SignerWithAddress;

  let poolTokens: TokenList;
  let vault: Contract;
  let stakingContract: Contract;
  let callbackContract: Contract;
  let rewardToken: Token;
  let pool: Contract;

  before('deploy base contracts', async () => {
    [, , lp, mockAssetManager] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager and exiter', async () => {
    const { contracts } = await setup();

    pool = contracts.pool;
    vault = contracts.vault;
    stakingContract = contracts.stakingContract;
    rewardToken = contracts.rewardTokens.DAI;
    poolTokens = contracts.tokens;

    callbackContract = await deploy('Exiter', { args: [vault.address] });
  });

  describe('with a stake and a reward', () => {
    const rewardAmount = fp(1);
    let assets: string[];
    let poolId: string;

    sharedBeforeEach(async () => {
      await stakingContract
        .connect(mockAssetManager)
        .allowlistRewarder(pool.address, rewardToken.address, mockAssetManager.address);
      await stakingContract.connect(mockAssetManager).addReward(pool.address, rewardToken.address, rewardsDuration);

      const bptBalance = await pool.balanceOf(lp.address);

      await pool.connect(lp).approve(stakingContract.address, bptBalance);

      await stakingContract.connect(lp)['stake(address,uint256)'](pool.address, bptBalance);

      await stakingContract
        .connect(mockAssetManager)
        .notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);
      await advanceTime(10);

      assets = poolTokens.map((pt) => pt.address);
      poolId = await pool.getPoolId();
    });

    it('emits PoolBalanceChanged when an LP exitsWithCallback', async () => {
      const args = [[pool.address], lp.address];
      const calldata = callbackContract.interface.encodeFunctionData('callback', args);

      const receipt = await (
        await stakingContract.connect(lp).exitWithCallback([pool.address], callbackContract.address, calldata)
      ).wait();

      const deltas = [bn('-199999999999999499800'), bn('-199999999999999499800')];

      expectEvent.inIndirectReceipt(receipt, vault.interface, 'PoolBalanceChanged', {
        poolId: poolId,
        liquidityProvider: callbackContract.address,
        tokens: assets,
        deltas,
        protocolFeeAmounts: [0, 0],
      });
    });

    it('sends the underlying asset to the LP', async () => {
      const args = [[pool.address], lp.address];
      const calldata = callbackContract.interface.encodeFunctionData('callback', args);

      await expectBalanceChange(
        () => stakingContract.connect(lp).exitWithCallback([pool.address], callbackContract.address, calldata),
        poolTokens,
        [{ account: lp.address, changes: { SNX: bn('199999999999999499800'), MKR: bn('199999999999999499800') } }]
      );
    });
  });
});
