import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { setup, rewardsDuration } from './MultiRewardsSharedSetup';

describe('Staking contract', () => {
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
    const rewardAmount = fp(1);
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
    });

    it('allows a user to claim the reward to a callback contract', async () => {
      const expectedReward = fp(1);
      const calldata = callbackContract.interface.encodeFunctionData('testCallback', []);

      await expectBalanceChange(
        () => stakingContract.connect(lp).getRewardWithCallback([pool.address], callbackContract.address, calldata),
        rewardTokens,
        [{ account: callbackContract.address, changes: { DAI: ['very-near', expectedReward] } }],
        vault
      );
    });

    it('calls the callback on the contract', async () => {
      const calldata = callbackContract.interface.encodeFunctionData('testCallback', []);

      const receipt = await (
        await stakingContract.connect(lp).getRewardWithCallback([pool.address], callbackContract.address, calldata)
      ).wait();

      expectEvent.inIndirectReceipt(receipt, callbackContract.interface, 'CallbackReceived', {});
    });
  });
});
