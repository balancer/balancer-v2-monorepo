import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { WEEK, advanceToTimestamp, currentTimestamp, currentWeekTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { Comparison, expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { random } from 'lodash';

describe('ChildChainGauge', () => {
  let vault: Vault;
  let gaugeFactory: Contract, gauge: Contract;
  let pseudoMinter: Contract, veDelegationProxy: Contract;
  let BAL: Contract, VE: Contract, BPT: Contract;
  let allRewards: TokenList;

  let admin: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress, other: SignerWithAddress;

  const version = JSON.stringify({
    name: 'ChildChainGauge',
    version: '0',
    deployment: 'test-deployment',
  });

  async function stakeBPT(user1Stake: BigNumber, user2Stake: BigNumber) {
    await BPT.mint(user1.address, user1Stake);
    await BPT.mint(user2.address, user2Stake);

    await BPT.connect(user1).approve(gauge.address, user1Stake);
    await BPT.connect(user2).approve(gauge.address, user2Stake);

    await gauge.connect(user1)['deposit(uint256)'](user1Stake);
    await gauge.connect(user2)['deposit(uint256)'](user2Stake);
  }

  // In this case we are using a null implementation in the proxy, so the boost depends on VE balances directly.
  async function setupBoosts(user1Boost: BigNumber, user2Boost: BigNumber) {
    await VE.mint(user1.address, user1Boost);
    await VE.mint(user2.address, user2Boost);
  }

  before('setup signers', async () => {
    [, admin, user1, user2, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy gauge factory', async () => {
    vault = await Vault.create({ admin });
    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });

    VE = await deploy('v2-solidity-utils/TestToken', { args: ['Voting Escrow', 'veBAL', 18] });
    BPT = await deploy('v2-solidity-utils/TestToken', { args: ['Balancer Pool Test token', 'BPTST', 18] });

    allRewards = await TokenList.create(8);

    // Using zero address as the implementation will forward the balance queries to VE directly.
    veDelegationProxy = await deploy('VotingEscrowDelegationProxy', {
      args: [vault.address, VE.address, ZERO_ADDRESS],
    });

    pseudoMinter = await deploy('L2BalancerPseudoMinter', { args: [vault.address, BAL.address] });

    const gaugeImplementation = await deploy('ChildChainGauge', {
      args: [veDelegationProxy.address, pseudoMinter.address, vault.authorizerAdaptor.address, version],
    });
    gaugeFactory = await deploy('ChildChainGaugeFactory', { args: [gaugeImplementation.address, '', version] });
  });

  sharedBeforeEach('add gauge factory to pseudo minter', async () => {
    await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin.address);

    await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);
  });

  sharedBeforeEach('create gauge', async () => {
    const tx = await gaugeFactory.create(BPT.address);
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    gauge = await deployedAt('ChildChainGauge', event.args.gauge);
  });

  describe('getters', () => {
    it('returns the LP token', async () => {
      expect(await gauge.lp_token()).to.be.eq(BPT.address);
    });

    it('returns the factory', async () => {
      expect(await gauge.factory()).to.be.eq(gaugeFactory.address);
    });

    it('returns the version', async () => {
      expect(await gauge.version()).to.be.eq(version);
    });

    it('returns the pseudo minter', async () => {
      expect(await gauge.bal_pseudo_minter()).to.be.eq(pseudoMinter.address);
    });

    it('returns the voting escrow proxy', async () => {
      expect(await gauge.voting_escrow_delegation_proxy()).to.be.eq(veDelegationProxy.address);
    });

    it('returns the authorizer adaptor', async () => {
      expect(await gauge.authorizer_adaptor()).to.be.eq(vault.authorizerAdaptor.address);
    });
  });

  describe('BAL rewards', () => {
    const bptAmount = fp(100);
    const balAmountPerWeek = fp(1000);

    async function stakeBPTAndBridgeBAL(bptUser1: BigNumber, bptUser2: BigNumber) {
      await stakeBPT(bptUser1, bptUser2);

      // This mocks BAL rewards bridged from L1; in practice they are not minted in the L2.
      // The rewards have to be deposited in the gauge before the checkpoints are made so as to
      // update their internal state with the right inflation rate for the period.
      await BAL.connect(admin).mint(gauge.address, balAmountPerWeek);
    }

    describe('checkpoint', () => {
      sharedBeforeEach('deposit BPT to gauge and "bridge" BAL rewards', async () => {
        await stakeBPTAndBridgeBAL(bptAmount, bptAmount);
      });

      it('transfers balance of BAL to the pseudo minter on the first checkpoint', async () => {
        // The first checkpoint updates liquidity limit with the new stake after depositing.
        const tx1 = await gauge.connect(user1).user_checkpoint(user1.address);

        expectTransferEvent(
          await tx1.wait(),
          { from: gauge.address, to: pseudoMinter.address, value: balAmountPerWeek },
          BAL.address
        );

        const tx2 = await gauge.connect(user2).user_checkpoint(user2.address);
        expectEvent.notEmitted(await tx2.wait(), 'Transfer');
      });

      it('updates the inflation rate for the period', async () => {
        const currentWeek = (await currentWeekTimestamp()).div(WEEK);
        const inflationRateBefore = await gauge.inflation_rate(currentWeek);
        await gauge.connect(user1).user_checkpoint(user1.address);
        const inflationRateAfter = await gauge.inflation_rate(currentWeek);

        const nextWeekTimestamp = (await currentWeekTimestamp()).add(WEEK);
        // new_rate = old_rate + BAL / (next_week_timestamp - current_timestamp)
        expect(inflationRateAfter).to.be.eq(
          inflationRateBefore.add(balAmountPerWeek.div(nextWeekTimestamp.sub(await currentTimestamp())))
        );
      });

      it('can be performed by any address', async () => {
        const tx = await gauge.connect(other).user_checkpoint(user1.address);
        expectEvent.inReceipt(await tx.wait(), 'UpdateLiquidityLimit', { _user: user1.address });
      });
    });

    describe('mint', () => {
      async function checkpointAndAdvanceWeek() {
        await gauge.connect(user1).user_checkpoint(user1.address);
        await gauge.connect(user2).user_checkpoint(user2.address);

        await advanceToTimestamp((await currentWeekTimestamp()).add(WEEK));
      }

      function itMintsRewardsForUsers(rewardUser1: BigNumber, rewardUser2: BigNumber) {
        it('outputs the claimable tokens', async () => {
          const availableTokens1 = await gauge.callStatic.claimable_tokens(user1.address);
          const availableTokens2 = await gauge.callStatic.claimable_tokens(user2.address);
          expect(availableTokens1).to.be.almostEqual(rewardUser1);
          expect(availableTokens2).to.be.almostEqual(rewardUser2);
        });

        it('"mints" BAL rewards for users', async () => {
          const receipt1 = await (await pseudoMinter.connect(user1).mint(gauge.address)).wait();
          const receipt2 = await (await pseudoMinter.connect(user2).mint(gauge.address)).wait();

          const user1Rewards = expectTransferEvent(
            receipt1,
            { from: pseudoMinter.address, to: user1.address },
            BAL.address
          );
          expect(user1Rewards.args.value).to.be.almostEqual(rewardUser1);

          const user2Rewards = expectTransferEvent(
            receipt2,
            { from: pseudoMinter.address, to: user2.address },
            BAL.address
          );

          expect(user2Rewards.args.value).to.be.almostEqual(rewardUser2);
        });

        it('updates claimable tokens', async () => {
          await pseudoMinter.connect(user1).mint(gauge.address);
          await pseudoMinter.connect(user2).mint(gauge.address);

          expect(await gauge.callStatic.claimable_tokens(user1.address)).to.be.eq(0);
          expect(await gauge.callStatic.claimable_tokens(user2.address)).to.be.eq(0);
        });
      }

      context('without VE boosts', () => {
        context('two users, equal BPT stake', () => {
          sharedBeforeEach(async () => {
            await stakeBPTAndBridgeBAL(bptAmount, bptAmount);
            await checkpointAndAdvanceWeek();
          });

          itMintsRewardsForUsers(balAmountPerWeek.div(2), balAmountPerWeek.div(2));
        });

        context('two users, unequal BPT stake', () => {
          sharedBeforeEach(async () => {
            await stakeBPTAndBridgeBAL(bptAmount, bptAmount.mul(2));
            await checkpointAndAdvanceWeek();
          });

          // User 2 has double the stake, so 1/3 of the rewards go to User 1, and 2/3 go to User 2.
          itMintsRewardsForUsers(balAmountPerWeek.div(3), balAmountPerWeek.mul(2).div(3));
        });
      });

      context('with VE boosts', () => {
        const baseBoost = fp(100);

        context('two users, equal BPT stake, only one boost', () => {
          sharedBeforeEach(async () => {
            await setupBoosts(baseBoost, fp(0));
            await stakeBPTAndBridgeBAL(bptAmount, bptAmount);
            await checkpointAndAdvanceWeek();
          });

          // Maximum boosted rewards is 2.5x larger than non-boosted rewards.
          // Since User 1 is the only boosted user and the stake among the two users is the same, the adjusted working
          // balance for User 1 will be 2.5x the adjusted working balance for User 2.
          // Since the rewards are proportional to the adjusted working balance, then:
          // (Rewards_User_1) + (Rewards_User_2) = Total_rewards
          // 2.5 RU2 + RU2 = Total_rewards
          // Solving for (RU1, RU2) --> User 1 gets 5/7 of the total, User 2 gets 2/7 of the total.
          itMintsRewardsForUsers(balAmountPerWeek.mul(5).div(7), balAmountPerWeek.mul(2).div(7));
        });

        context('two users, equal BPT stake, same boost', () => {
          sharedBeforeEach(async () => {
            await setupBoosts(baseBoost, baseBoost);
            await stakeBPTAndBridgeBAL(bptAmount, bptAmount);
            await checkpointAndAdvanceWeek();
          });

          // Both users have the same boost and stake, so they should get the same rewards.
          itMintsRewardsForUsers(balAmountPerWeek.div(2), balAmountPerWeek.div(2));
        });

        context('two users, unequal BPT stake and unequal boost', () => {
          sharedBeforeEach(async () => {
            await setupBoosts(baseBoost, baseBoost.mul(2));
            await stakeBPTAndBridgeBAL(bptAmount, bptAmount.mul(2));
            await checkpointAndAdvanceWeek();
          });

          // User 2 has double the stake and boost.
          // Since the stake and the boost contribute proportionally to the rewards (40% and 60% respectively),
          // and both are doubled for User 2, they'll get twice the rewards as User 1.
          // Same stake and boosts is then equal to the case with same stake and no boosts.
          // In this case the working balance cap is not triggered.
          itMintsRewardsForUsers(balAmountPerWeek.div(3), balAmountPerWeek.mul(2).div(3));
        });

        context('two users, unequal BPT stake and unequal boost', () => {
          sharedBeforeEach(async () => {
            await setupBoosts(baseBoost.mul(2), baseBoost);
            await stakeBPTAndBridgeBAL(bptAmount, bptAmount.mul(2));
            await checkpointAndAdvanceWeek();
          });

          // In this case, User 1 gets the maximum boost, since the boosted working balance is above the user's stake.
          // Here's how adjusted working balances (WB1* and WB2*) are calculated, considering
          // BPT = bptAmount, and Boost = baseBoost:
          // WB1* = min(0.4 * BPT + 0.6 * (Boost * 2) / (Boost * 3) * (BPT * 3), BPT) = BPT.
          // WB2* = min(0.4 * (BPT * 2) + 0.6 * Boost / (Boost * 3) * (BPT * 3), 2 BPT) = 1.4 BPT
          // Then, WB2* = 14/10 * WB1*.
          // Since the rewards are proportional to the adjusted working balances:
          // Rewards_User_2 = 14/10 * Rewards_User_1, and Rewards_User_1 + Rewards_User_2 = Total_rewards.
          // Solving for (RU1, RU2) --> User 1 gets 5/12 of the total, User 2 gets 7/12 of the total.
          itMintsRewardsForUsers(balAmountPerWeek.mul(5).div(12), balAmountPerWeek.mul(7).div(12));
        });
      });
    });
  });

  describe('non-BAL rewards', () => {
    const bptAmount = fp(10);
    const rewardAmount = fp(100);

    const claim = 'claim_rewards(address,address,uint256[])';
    const claimSelected = () =>
      gauge.connect(claimer)[claim](claimer.address, ZERO_ADDRESS, allRewards.indicesOf(selectedRewards.tokens));
    const claimAll = () => gauge.connect(claimer)['claim_rewards(address,address)'](claimer.address, ZERO_ADDRESS);

    let addedRewards: TokenList;
    let selectedRewards: TokenList;
    let claimer: SignerWithAddress;

    function itTransfersRewardsToClaimer(claimFunction: () => Promise<unknown> = claimSelected) {
      let expectedReward: BigNumber;

      sharedBeforeEach('estimate expected reward', async () => {
        // Claimer rewards are proportional to their BPT stake in the gauge given that staking time is constant for all
        // users.
        const claimerStake = await gauge.balanceOf(claimer.address);
        const gaugeTotalSupply = await gauge.totalSupply();
        expectedReward = rewardAmount.mul(claimerStake).div(gaugeTotalSupply);
      });

      it("transfers rewards to claimer without affecting other users' rewards", async () => {
        const expectedBalanceChanges = [
          {
            account: gauge.address,
            changes: selectedRewards.reduce((acc, token) => {
              acc[token.symbol] = ['near', expectedReward.mul(-1)]; // Outgoing
              return acc;
            }, {} as Record<string, Comparison>),
          },
          {
            account: claimer,
            changes: selectedRewards.reduce((acc, token) => {
              acc[token.symbol] = ['near', expectedReward];
              return acc;
            }, {} as Record<string, Comparison>),
          },
        ];

        // All the rewards are available in the gauge at this point.
        // We claim only the selected ones by sending the indices that correspond to them, but we monitor the balance
        // change of all the rewards inconditionally. This way, we ensure that only the selected rewards are transferred
        // and the remaining ones are not affected.
        await expectBalanceChange(claimFunction, addedRewards, expectedBalanceChanges);
      });

      it('updates claimed balance for claimer', async () => {
        const claimedBefore = await Promise.all(
          selectedRewards.map((token) => gauge.claimed_reward(claimer.address, token.address))
        );
        expect(claimedBefore).to.be.deep.eq(Array(selectedRewards.length).fill(0));

        await claimFunction();
        const claimedAfter = await Promise.all(
          selectedRewards.map((token) => gauge.claimed_reward(claimer.address, token.address))
        );
        expect(claimedAfter).to.be.almostEqual(Array(selectedRewards.length).fill(expectedReward));
      });

      it('keeps the same claimed balances for others', async () => {
        const claimedBefore = await Promise.all(
          selectedRewards.map((token) => gauge.claimed_reward(other.address, token.address))
        );

        await claimFunction();
        const claimedAfter = await Promise.all(
          selectedRewards.map((token) => gauge.claimed_reward(other.address, token.address))
        );
        expect(claimedBefore).to.be.deep.eq(claimedAfter);
      });

      it('updates claimable balance for user', async () => {
        const claimableBefore = await Promise.all(
          selectedRewards.map((token) => gauge.claimable_reward(claimer.address, token.address))
        );
        expect(claimableBefore).to.be.almostEqual(Array(selectedRewards.length).fill(expectedReward));

        await claimFunction();
        const claimableAfter = await Promise.all(
          selectedRewards.map((token) => gauge.claimable_reward(claimer.address, token.address))
        );
        expect(claimableAfter).to.be.deep.eq(Array(selectedRewards.length).fill(0));
      });

      it('keeps the same claimable balances for others', async () => {
        const claimableBefore = await Promise.all(
          selectedRewards.map((token) => gauge.claimable_reward(other.address, token.address))
        );

        await claimFunction();
        const claimableAfter = await Promise.all(
          selectedRewards.map((token) => gauge.claimable_reward(other.address, token.address))
        );
        expect(claimableAfter).to.be.deep.eq(claimableBefore);
      });
    }

    function itClaimsRewards(user1Stake: BigNumber, user2Stake: BigNumber) {
      sharedBeforeEach('stake BPT and wait', async () => {
        // Boosts shouldn't affect rewards; we add a random amount to each user to verify it.
        await setupBoosts(fp(random(100, 10000)), fp(random(1, 30000)));
        await stakeBPT(user1Stake, user2Stake);
        // Rewards are distributed throughout a week
        await advanceToTimestamp((await currentTimestamp()).add(WEEK));
      });

      context('all rewards with no explicit indexes', () => {
        sharedBeforeEach(() => {
          selectedRewards = addedRewards;
        });

        itTransfersRewardsToClaimer(claimAll);
      });

      context('all rewards using indexes', () => {
        sharedBeforeEach(() => {
          selectedRewards = addedRewards;
        });

        itTransfersRewardsToClaimer(claimSelected);
      });

      context('selecting consecutive rewards', () => {
        sharedBeforeEach(() => {
          selectedRewards = addedRewards.subset(3, 2);
        });

        itTransfersRewardsToClaimer(claimSelected);
      });

      context('selecting random rewards', () => {
        sharedBeforeEach(() => {
          selectedRewards = new TokenList([addedRewards.get(4), addedRewards.get(3), addedRewards.get(1)]);
        });

        itTransfersRewardsToClaimer(claimSelected);
      });

      context('selecting the same reward more than once', () => {
        sharedBeforeEach(() => {
          selectedRewards = new TokenList([
            addedRewards.get(4),
            addedRewards.get(3),
            addedRewards.get(3),
            addedRewards.get(3),
          ]);
        });

        itTransfersRewardsToClaimer(claimSelected);
      });
    }

    function itAddsAndClaimsRewards() {
      sharedBeforeEach('add rewards', async () => {
        await Promise.all(
          addedRewards.addresses.map((reward) =>
            vault.authorizerAdaptorEntrypoint
              .connect(admin)
              .performAction(gauge.address, gauge.interface.encodeFunctionData('add_reward', [reward, admin.address]))
          )
        );
      });

      sharedBeforeEach('deposit reward tokens and set claimer', async () => {
        await addedRewards.mint({ to: admin, amount: rewardAmount });
        await addedRewards.approve({ from: admin, to: gauge.address });

        await Promise.all(
          addedRewards.addresses.map((reward) => gauge.connect(admin).deposit_reward_token(reward, rewardAmount))
        );

        claimer = user1;
      });

      context('one user', () => {
        itClaimsRewards(bptAmount, bn(0));
      });

      context('two users with equal stake', () => {
        itClaimsRewards(bptAmount, bptAmount);
      });

      context('two users with unequal stake', () => {
        itClaimsRewards(bptAmount.mul(7), bptAmount);
      });

      it('reverts with explicit invalid index', async () => {
        await expect(
          gauge.connect(claimer)[claim](claimer.address, ZERO_ADDRESS, [addedRewards.length])
        ).to.be.revertedWith('INVALID_REWARD_INDEX');
      });
    }

    sharedBeforeEach('grant add_reward permission to admin', async () => {
      const action = await actionId(vault.authorizerAdaptorEntrypoint, 'add_reward', gauge.interface);
      await vault.grantPermissionGlobally(action, admin);
    });

    context('with all rewards', () => {
      sharedBeforeEach(() => {
        addedRewards = allRewards;
      });

      itAddsAndClaimsRewards();
    });

    context('with some rewards', () => {
      sharedBeforeEach(() => {
        addedRewards = allRewards.subset(5);
      });

      itAddsAndClaimsRewards();
    });

    context('with no rewards', () => {
      it('reverts with explicit invalid index', async () => {
        await expect(gauge.connect(claimer)[claim](claimer.address, ZERO_ADDRESS, [0])).to.be.revertedWith(
          'INVALID_REWARD_INDEX'
        );
      });

      it('it does nothing with implicit indexes', async () => {
        const tx = await claimAll();
        expectEvent.notEmitted(await tx.wait(), 'Transfer');
      });
    });

    context('with broken rewards', () => {
      let functionalReward: Contract;
      let flakyReward: Contract;

      sharedBeforeEach('add rewards and break token after deposit', async () => {
        // Add and deposit broken reward
        flakyReward = await deploy('v2-solidity-utils/BreakableERC20Mock', { args: ['Broken token', 'BRK'] });
        await vault.authorizerAdaptorEntrypoint
          .connect(admin)
          .performAction(
            gauge.address,
            gauge.interface.encodeFunctionData('add_reward', [flakyReward.address, admin.address])
          );
        await flakyReward.mint(admin.address, rewardAmount);
        await flakyReward.connect(admin).approve(gauge.address, rewardAmount);

        await gauge.connect(admin).deposit_reward_token(flakyReward.address, rewardAmount);
        await flakyReward.setIsBroken(true);

        // Add and deposit functional reward
        functionalReward = await deploy('v2-solidity-utils/TestToken', { args: ['Test functionalReward', 'RWRD', 18] });
        await vault.authorizerAdaptorEntrypoint
          .connect(admin)
          .performAction(
            gauge.address,
            gauge.interface.encodeFunctionData('add_reward', [functionalReward.address, admin.address])
          );
        await functionalReward.mint(admin.address, rewardAmount);
        await functionalReward.connect(admin).approve(gauge.address, rewardAmount);

        await gauge.connect(admin).deposit_reward_token(functionalReward.address, rewardAmount);

        // Only one user
        await stakeBPT(bptAmount, bn(0));
        await advanceToTimestamp((await currentTimestamp()).add(WEEK));
        claimer = user1;
      });

      it('reverts claiming broken rewards with explicit index', async () => {
        await expect(gauge.connect(claimer)[claim](claimer.address, ZERO_ADDRESS, [0])).to.be.revertedWith(
          'BROKEN_TOKEN'
        );
      });

      it('reverts claiming broken rewards with implicit indexes', async () => {
        await expect(claimAll()).to.be.revertedWith('BROKEN_TOKEN');
      });

      it('can still claim working rewards', async () => {
        const tx = await gauge.connect(claimer)[claim](claimer.address, ZERO_ADDRESS, [1]);
        const event = expectTransferEvent(
          await tx.wait(),
          { from: gauge.address, to: claimer.address },
          functionalReward.address
        );

        expect(event.args.value).to.be.almostEqual(rewardAmount);
      });

      it('can claim flaky reward if it gets fixed without affecting other claims', async () => {
        const tx1 = await gauge.connect(claimer)[claim](claimer.address, ZERO_ADDRESS, [1]);
        const event1 = expectTransferEvent(
          await tx1.wait(),
          { from: gauge.address, to: claimer.address },
          functionalReward.address
        );
        expect(event1.args.value).to.be.almostEqual(rewardAmount);
        const functionalRewardBalanceBeforeClaimAll = await functionalReward.balanceOf(claimer.address);

        // Mock reward fix.
        await flakyReward.setIsBroken(false);

        // Claim all only gets unclaimed rewards (i.e. the flaky reward that is now fixed)
        const tx2 = await claimAll();
        const event2 = expectTransferEvent(
          await tx2.wait(),
          { from: gauge.address, to: claimer.address },
          flakyReward.address
        );
        expect(event2.args.value).to.be.almostEqual(rewardAmount);
        const functionalRewardBalanceAfterClaimAll = await functionalReward.balanceOf(claimer.address);
        expect(functionalRewardBalanceAfterClaimAll).to.be.eq(functionalRewardBalanceBeforeClaimAll);
      });

      it('can still deposit', async () => {
        const stake = fp(1000);
        await BPT.mint(user1.address, stake);
        await BPT.connect(user1).approve(gauge.address, stake);

        const tx = await gauge.connect(user1)['deposit(uint256)'](stake);
        expectTransferEvent(await tx.wait(), { from: user1.address, to: gauge.address, value: stake }, BPT.address);
      });

      it('can still withdraw', async () => {
        const tx = await gauge.connect(user1)['withdraw(uint256)'](bptAmount);
        expectTransferEvent(await tx.wait(), { from: gauge.address, to: user1.address, value: bptAmount }, BPT.address);
      });

      it('can still transfer', async () => {
        const tx = await gauge.connect(user1)['transfer(address,uint256)'](user2.address, bptAmount);
        expectTransferEvent(
          await tx.wait(),
          { _from: user1.address, _to: user2.address, _value: bptAmount },
          gauge.address
        );
      });
    });

    it('reverts adding BAL as a reward', async () => {
      await expect(
        vault.authorizerAdaptorEntrypoint
          .connect(admin)
          .performAction(gauge.address, gauge.interface.encodeFunctionData('add_reward', [BAL.address, admin.address]))
      ).to.be.revertedWith('CANNOT_ADD_BAL_REWARD');
    });
  });
});
