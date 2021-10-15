import { ethers } from 'hardhat';
import { Contract, utils } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { setup, rewardsDuration, rewardsVestingTime } from './MultiRewardsSharedSetup';

describe('Exiter', () => {
  let lp: SignerWithAddress, rewarder: SignerWithAddress;

  let poolTokens: TokenList;
  let vault: Contract;
  let stakingContract: Contract;
  let callbackContract: Contract;
  let rewardToken: Token;
  let pool: Contract;

  before('deploy base contracts', async () => {
    [, , lp, rewarder] = await ethers.getSigners();
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
      await stakingContract.connect(rewarder).whitelistRewarder(pool.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);

      const bptBalance = await pool.balanceOf(lp.address);

      await pool.connect(lp).approve(stakingContract.address, bptBalance);

      await stakingContract.connect(lp).stake(pool.address, bptBalance);

      await stakingContract
        .connect(rewarder)
        .notifyRewardAmount(pool.address, rewardToken.address, rewardAmount, rewarder.address);
      await advanceTime(rewardsVestingTime);

      assets = poolTokens.map((pt) => pt.address);
      poolId = await pool.getPoolId();
    });

    it('emits PoolBalanceChanged when an LP exitsWithCallback', async () => {
      const args = [[pool.address], lp.address];
      const calldata = utils.defaultAbiCoder.encode(['(address[], address)'], [args]);

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
      const calldata = utils.defaultAbiCoder.encode(['(address[],address)'], [args]);

      await expectBalanceChange(
        () => stakingContract.connect(lp).exitWithCallback([pool.address], callbackContract.address, calldata),
        poolTokens,
        [{ account: lp.address, changes: { SNX: bn('199999999999999499800'), MKR: bn('199999999999999499800') } }]
      );
    });
  });
});
