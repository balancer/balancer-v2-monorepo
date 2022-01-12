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
import { MultiDistributor } from '@balancer-labs/v2-helpers/src/models/distributor/MultiDistributor';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

describe('Staking contract - callbacks', () => {
  let lp: SignerWithAddress, mockAssetManager: SignerWithAddress;

  let rewardTokens: TokenList;
  let vault: Vault;
  let stakingContract: MultiDistributor;
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
      await stakingContract.newDistribution(pool, rewardToken, rewardsDuration, {
        from: mockAssetManager,
      });

      const bpt = await Token.deployedAt(pool.address);

      const bptBalance = await bpt.balanceOf(lp.address);
      await bpt.approve(stakingContract, bptBalance, { from: lp });

      id = await stakingContract.getDistributionId(bpt, rewardToken, mockAssetManager);
      await stakingContract.subscribe(id, { from: lp });
      await stakingContract.stake(bpt, bptBalance, lp, lp, { from: lp });

      await rewardToken.approve(stakingContract, bptBalance, { from: mockAssetManager });
      await stakingContract.fundDistribution(id, rewardAmount, { from: mockAssetManager });
      await advanceTime(rewardsVestingTime);
    });

    it('allows a user to claim the reward to a callback contract', async () => {
      const expectedReward = fp(1);
      const calldata = utils.defaultAbiCoder.encode([], []);

      await expectBalanceChange(
        () => stakingContract.claimWithCallback(id, lp, callbackContract, calldata, { from: lp }),
        rewardTokens,
        [{ account: callbackContract, changes: { DAI: ['very-near', expectedReward] } }],
        vault.instance
      );
    });

    it('calls the callback on the contract', async () => {
      const calldata = utils.defaultAbiCoder.encode([], []);

      const receipt = await (
        await stakingContract.claimWithCallback(id, lp, callbackContract, calldata, { from: lp })
      ).wait();

      expectEvent.inIndirectReceipt(receipt, callbackContract.interface, 'CallbackReceived', {});
    });
  });
});
