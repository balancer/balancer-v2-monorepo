import { ethers } from 'hardhat';
import { Contract, utils } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { setup, rewardsDuration, rewardsVestingTime } from './MultiDistributorSharedSetup';

describe('Staking contract - callbacks', () => {
  let lp: SignerWithAddress, mockAssetManager: SignerWithAddress;

  let rewardTokens: TokenList;
  let vault: Contract;
  let stakingContract: Contract;
  let callbackContract: Contract;
  let rewardToken: Token;
  let pool: Contract;

  before('deploy base contracts', async () => {
    [, , lp, mockAssetManager] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager and mock callback', async () => {
    const { contracts } = await setup();

    pool = contracts.pool;
    vault = contracts.vault;
    stakingContract = contracts.stakingContract;
    rewardToken = contracts.rewardTokens.DAI;
    rewardTokens = contracts.rewardTokens;

    callbackContract = await deploy('MockRewardCallback');
  });

  describe('with a stake and a reward', () => {
    let id: string;
    const rewardAmount = fp(1);

    sharedBeforeEach(async () => {
      await stakingContract
        .connect(mockAssetManager)
        .createDistribution(pool.address, rewardToken.address, rewardsDuration);

      const bptBalance = await pool.balanceOf(lp.address);

      await pool.connect(lp).approve(stakingContract.address, bptBalance);

      id = await stakingContract.getDistributionId(pool.address, rewardToken.address, mockAssetManager.address);
      await stakingContract.connect(lp).subscribeDistributions([id]);
      await stakingContract.connect(lp).stake(pool.address, bptBalance, lp.address, lp.address);

      await stakingContract.connect(mockAssetManager).fundDistribution(id, rewardAmount);
      await advanceTime(rewardsVestingTime);
    });

    it('allows a user to claim the reward to a callback contract', async () => {
      const expectedReward = fp(1);
      const calldata = utils.defaultAbiCoder.encode([], []);

      await expectBalanceChange(
        () => stakingContract.connect(lp).claimWithCallback([id], lp.address, callbackContract.address, calldata),
        rewardTokens,
        [{ account: callbackContract.address, changes: { DAI: ['very-near', expectedReward] } }],
        vault
      );
    });

    it('calls the callback on the contract', async () => {
      const calldata = utils.defaultAbiCoder.encode([], []);

      const receipt = await (
        await stakingContract.connect(lp).claimWithCallback([id], lp.address, callbackContract.address, calldata)
      ).wait();

      expectEvent.inIndirectReceipt(receipt, callbackContract.interface, 'CallbackReceived', {});
    });
  });
});
