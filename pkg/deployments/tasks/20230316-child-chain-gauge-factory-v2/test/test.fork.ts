import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract, ContractReceipt } from 'ethers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { WEEK, advanceToTimestamp, currentTimestamp, currentWeekTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('ChildChainGaugeFactoryV2', 'arbitrum', 72486400, function () {
  let vault: Contract, authorizer: Contract, authorizerAdaptor: Contract;
  let gaugeFactory: Contract, pseudoMinter: Contract, veProxy: Contract, gauge: Contract;
  let admin: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress, govMultisig: SignerWithAddress;
  let whale: SignerWithAddress;
  let gateway: SignerWithAddress;
  let BPT: Contract, BAL: Contract, USDT: Contract;

  let task: Task;

  const GOV_MULTISIG = '0xaf23dc5983230e9eeaf93280e312e57539d098d0';
  const RDNT_WETH_POOL = '0x32dF62dc3aEd2cD6224193052Ce665DC18165841';
  const BPT_HOLDER_1 = '0x1967654222ec22e37c0b0c2a15583b9581d3095e';
  const BPT_HOLDER_2 = '0x708e5804d0e930fac266d8b3f3e13edba35ac86e';
  const BAL_L2_GATEWAY = '0x09e9222e96e7b4ae2a407b98d48e330053351eee';

  const USDT_ADDRESS = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
  const USDT_WHALE = '0xf89d7b9c864f589bbf53a82105107622b35eaa40';

  async function stakeBPT(user1Stake: BigNumber, user2Stake: BigNumber) {
    await BPT.connect(user1).approve(gauge.address, user1Stake);
    await BPT.connect(user2).approve(gauge.address, user2Stake);

    await gauge.connect(user1)['deposit(uint256)'](user1Stake);
    await gauge.connect(user2)['deposit(uint256)'](user2Stake);
  }

  async function bridgeBAL(to: string, amount: BigNumberish) {
    const bridgeInterface = ['function bridgeMint(address account, uint256 amount) external'];
    const BAL = await ethers.getContractAt(bridgeInterface, await pseudoMinter.getBalancerToken());
    await BAL.connect(gateway).bridgeMint(to, amount);
  }

  async function checkpointAndAdvanceWeek() {
    await gauge.connect(user1).user_checkpoint(user1.address);
    await gauge.connect(user2).user_checkpoint(user2.address);

    await advanceToTimestamp((await currentWeekTimestamp()).add(WEEK));
  }

  before('run task', async () => {
    task = new Task('20230316-child-chain-gauge-factory-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    gaugeFactory = await task.deployedInstance('ChildChainGaugeFactory');
  });

  before('setup accounts', async () => {
    [, admin] = await ethers.getSigners();
    user1 = await impersonate(BPT_HOLDER_1, fp(100));
    user2 = await impersonate(BPT_HOLDER_2, fp(100));
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));
    whale = await impersonate(USDT_WHALE, fp(1000));

    // The gateway is actually a contract, but we impersonate it to be able to call `mint` on the BAL token, simulating
    // a token bridge.
    gateway = await impersonate(BAL_L2_GATEWAY, fp(100));
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.deployedInstance('AuthorizerAdaptor');

    const pseudoMinterTask = new Task('20230316-l2-balancer-pseudo-minter', TaskMode.READ_ONLY, getForkedNetwork(hre));
    pseudoMinter = await pseudoMinterTask.deployedInstance('L2BalancerPseudoMinter');

    const veProxyTask = new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY, getForkedNetwork(hre));
    veProxy = await veProxyTask.deployedInstance('VotingEscrowDelegationProxy');
  });

  before('setup tokens', async () => {
    BPT = await task.instanceAt('IERC20', RDNT_WETH_POOL);
    USDT = await task.instanceAt('IERC20', USDT_ADDRESS);
    BAL = await task.instanceAt('IERC20', await pseudoMinter.getBalancerToken());
  });

  before('grant add / remove child chain gauge factory permissions to admin', async () => {
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer.connect(govMultisig).grantRole(await actionId(pseudoMinter, 'addGaugeFactory'), admin.address);
    await authorizer.connect(govMultisig).grantRole(await actionId(pseudoMinter, 'removeGaugeFactory'), admin.address);
  });

  describe('create', () => {
    it('returns factory version', async () => {
      const expectedFactoryVersion = {
        name: 'ChildChainGaugeFactory',
        version: 2,
        deployment: '20230316-child-chain-gauge-factory-v2',
      };
      expect(await gaugeFactory.version()).to.equal(JSON.stringify(expectedFactoryVersion));
    });

    it('adds gauge factory to pseudo minter', async () => {
      await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);
      expect(await pseudoMinter.isValidGaugeFactory(gaugeFactory.address)).to.be.true;
    });

    it('create gauge', async () => {
      const tx = await gaugeFactory.create(BPT.address);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
      gauge = await task.instanceAt('ChildChainGauge', event.args.gauge);

      expect(await gaugeFactory.isGaugeFromFactory(gauge.address)).to.be.true;
    });
  });

  describe('getters', () => {
    it('returns BPT', async () => {
      expect(await gauge.lp_token()).to.equal(BPT.address);
    });

    it('returns factory', async () => {
      expect(await gauge.factory()).to.equal(gaugeFactory.address);
    });

    it('returns gauge version', async () => {
      const expectedGaugeVersion = {
        name: 'ChildChainGauge',
        version: 2,
        deployment: '20230316-child-chain-gauge-factory-v2',
      };
      expect(await gauge.version()).to.equal(JSON.stringify(expectedGaugeVersion));
    });

    it('returns the pseudo minter', async () => {
      expect(await gauge.bal_pseudo_minter()).to.be.eq(pseudoMinter.address);
    });
  });

  describe('BAL rewards', () => {
    const balPerWeek = fp(2000);
    const bptAmount = fp(100);

    function itMintsRewardsForUsers(rewardUser1: BigNumber, rewardUser2: BigNumber) {
      describe('reward distribution', () => {
        before(async () => {
          await checkpointAndAdvanceWeek();
        });

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
          expect(await gauge.callStatic.claimable_tokens(user1.address)).to.be.eq(0);
          expect(await gauge.callStatic.claimable_tokens(user2.address)).to.be.eq(0);
        });
      });
    }

    context('without boosts', () => {
      before('stake BPT to the gauges and bridge BAL rewards', async () => {
        await stakeBPT(bptAmount, bptAmount.mul(2));
        await bridgeBAL(gauge.address, balPerWeek);
        expect(await BAL.balanceOf(gauge.address)).to.be.eq(balPerWeek);
        expect(await BAL.balanceOf(pseudoMinter.address)).to.be.eq(0);
      });

      it('checkpoints the gauge and moves the rewards to the pseudo minter', async () => {
        await gauge.user_checkpoint(user1.address);
        await gauge.user_checkpoint(user2.address);

        expect(await BAL.balanceOf(gauge.address)).to.be.eq(0);
        expect(await BAL.balanceOf(pseudoMinter.address)).to.be.eq(balPerWeek);
      });

      // User 2 has double the stake, so 1/3 of the rewards go to User 1, and 2/3 go to User 2.
      itMintsRewardsForUsers(balPerWeek.div(3), balPerWeek.mul(2).div(3));

      context('with extra rewards', () => {
        const extraReward = balPerWeek.mul(20);

        before('stake BPT to the gauges and bridge BAL rewards', async () => {
          await bridgeBAL(gauge.address, extraReward);
        });

        // User 2 has double the stake, so 1/3 of the rewards go to User 1, and 2/3 go to User 2.
        // The increased rewards are still distributed proportionally.
        itMintsRewardsForUsers(extraReward.div(3), extraReward.mul(2).div(3));
      });
    });

    context('with boosts', () => {
      let mockVE: Contract, veBoost: Contract;
      const boost = fp(100);

      // MockVE balances represent veBAL balances bridged to the L2.
      async function setupBoosts(user1Boost: BigNumber, user2Boost: BigNumber) {
        await mockVE.mint(user1.address, user1Boost);
        await mockVE.mint(user2.address, user2Boost);
      }

      before('update VE implementation in the proxy', async () => {
        await authorizer.connect(govMultisig).grantRole(await actionId(veProxy, 'setDelegation'), admin.address);

        // In practice, the contract that provides veBAL balances is a third party contract (e.g. Layer Zero).
        mockVE = await deploy('MockVE');
        veBoost = await deploy('VeBoostV2', { args: [ZERO_ADDRESS, mockVE.address] });

        await bridgeBAL(gauge.address, balPerWeek);
        await setupBoosts(boost.mul(2), boost);
      });

      it('sets delegation', async () => {
        const tx = await veProxy.connect(admin).setDelegation(veBoost.address);
        expectEvent.inReceipt(await tx.wait(), 'DelegationImplementationUpdated', {
          newImplementation: veBoost.address,
        });
      });

      context('without delegations', () => {
        before('status checks', async () => {
          const user1Stake = await gauge.balanceOf(user1.address);
          const user2Stake = await gauge.balanceOf(user2.address);

          const user1Boost = await veProxy.adjustedBalanceOf(user1.address);
          const user2Boost = await veProxy.adjustedBalanceOf(user2.address);

          // User 1 has half the stake and twice the boost as user 1.
          expect(user1Stake).to.be.eq(bptAmount);
          expect(user2Stake).to.be.eq(user1Stake.mul(2));
          expect(user1Boost).to.be.eq(boost.mul(2));
          expect(user2Boost).to.be.eq(user1Boost.div(2));

          // Base boost and stake are equal in nominal terms.
          expect(boost).to.be.eq(bptAmount);
        });

        // See unit test for reference: 'two users, unequal BPT stake and unequal boost'.
        itMintsRewardsForUsers(balPerWeek.mul(5).div(12), balPerWeek.mul(7).div(12));
      });

      context('with delegations', () => {
        const boostFn = 'boost(address,uint256,uint256)';

        before('delegate boosts', async () => {
          await bridgeBAL(gauge.address, balPerWeek);

          await mockVE.setLockedEnd(user1.address, MAX_UINT256);
          await mockVE.setLockedEnd(user2.address, MAX_UINT256);

          const endTime = (await currentWeekTimestamp()).add(WEEK);
          await veBoost.connect(user1)[boostFn](user2.address, boost, endTime);
        });

        before('status checks', async () => {
          const user1Stake = await gauge.balanceOf(user1.address);
          const user2Stake = await gauge.balanceOf(user2.address);

          const user1Boost = await veProxy.adjustedBalanceOf(user1.address);
          const user2Boost = await veProxy.adjustedBalanceOf(user2.address);

          // User 2 has twice the stake and twice the boost as user 1.
          expect(user1Stake).to.be.eq(bptAmount);
          expect(user2Stake).to.be.eq(user1Stake.mul(2));
          expect(user1Boost).to.be.almostEqual(boost); // Using almostEqual because of VeBoostV2 inner accounting.
          expect(user2Boost).to.be.almostEqual(user1Boost.mul(2));

          // Base boost and stake are equal in nominal terms.
          expect(boost).to.be.eq(bptAmount);
        });

        // See unit test for reference: 'two users, unequal BPT stake and unequal boost'.
        itMintsRewardsForUsers(balPerWeek.div(3), balPerWeek.mul(2).div(3));

        context('after delegation expires', () => {
          before('bridge BAL and check status', async () => {
            await bridgeBAL(gauge.address, balPerWeek);

            const user1Boost = await veProxy.adjustedBalanceOf(user1.address);
            const user2Boost = await veProxy.adjustedBalanceOf(user2.address);

            // One week has passed after the last test, which means the delegation has ended.
            // Therefore, we go back to the original case without delegations.
            expect(user1Boost).to.be.eq(boost.mul(2));
            expect(user2Boost).to.be.eq(user1Boost.div(2));

            // Base boost and stake are equal in nominal terms.
            expect(boost).to.be.eq(bptAmount);
          });

          // Same case as 'without delegations' again.
          itMintsRewardsForUsers(balPerWeek.mul(5).div(12), balPerWeek.mul(7).div(12));
        });

        context('when veBAL lock expired before delegating boost', () => {
          before(async () => {
            await mockVE.setLockedEnd(user1.address, (await currentTimestamp()).sub(1));
          });

          it('reverts', async () => {
            const endTime = (await currentWeekTimestamp()).add(WEEK);
            await expect(veBoost.connect(user1)[boostFn](user2.address, boost, endTime)).to.be.reverted;
          });
        });

        context('after killing delegation implementation', () => {
          before(async () => {
            await authorizer.connect(govMultisig).grantRole(await actionId(veProxy, 'killDelegation'), admin.address);
            await veProxy.connect(admin).killDelegation();
            await bridgeBAL(gauge.address, balPerWeek);
          });

          // Same case as 'without boosts' again.
          itMintsRewardsForUsers(balPerWeek.div(3), balPerWeek.mul(2).div(3));
        });
      });
    });
  });

  describe('other rewards', () => {
    const rewardAmount = fp(1e6).div(bn(1e12)); // Scaling factor is 1e12 since USDT has 6 decimals.
    let reward: Contract;
    let distributor: SignerWithAddress;
    let claimer: SignerWithAddress, other: SignerWithAddress;

    function itTransfersRewardsToClaimer() {
      let expectedReward: BigNumber;
      let receipt: ContractReceipt;
      let claimedBeforeOther: BigNumber;
      let claimableBeforeOther: BigNumber;

      before('estimate expected reward', async () => {
        // Claimer rewards are proportional to their BPT stake in the gauge given that staking time is constant for all
        // users.
        const claimerStake = await gauge.balanceOf(claimer.address);
        const gaugeTotalSupply = await gauge.totalSupply();
        expectedReward = rewardAmount.mul(claimerStake).div(gaugeTotalSupply);

        claimedBeforeOther = await gauge.claimed_reward(other.address, reward.address);
        claimableBeforeOther = await gauge.claimable_reward(other.address, reward.address);

        receipt = await (
          await gauge.connect(claimer)['claim_rewards(address,address)'](claimer.address, ZERO_ADDRESS)
        ).wait();
      });

      it('transfers rewards to claimer', async () => {
        const event = expectTransferEvent(receipt, { from: gauge.address, to: claimer.address }, reward.address);
        expect(event.args.value).to.be.almostEqual(expectedReward);
      });

      it('updates claimed balance for claimer', async () => {
        const claimedAfterClaimer = await gauge.claimed_reward(claimer.address, reward.address);
        expect(claimedAfterClaimer).to.be.almostEqual(expectedReward);
      });

      it('keeps the same claimed balances for others', async () => {
        const claimedAfterOther = await gauge.claimed_reward(other.address, reward.address);
        expect(claimedAfterOther).to.be.eq(claimedBeforeOther);
      });

      it('updates claimable balance for claimer', async () => {
        const claimableAfterClaimer = await gauge.claimable_reward(claimer.address, reward.address);
        expect(claimableAfterClaimer).to.be.eq(0);
      });

      it('keeps the same claimable balances for others', async () => {
        const claimableAfterOther = await gauge.claimable_reward(other.address, reward.address);
        expect(claimableAfterOther).to.be.deep.eq(claimableBeforeOther);
      });
    }

    before(async () => {
      reward = USDT;
      distributor = whale;
      claimer = user1;
      other = user2;
      await authorizer
        .connect(govMultisig)
        .grantRole(await actionId(authorizerAdaptor, 'add_reward', gauge.interface), admin.address);

      authorizerAdaptor
        .connect(admin)
        .performAction(
          gauge.address,
          gauge.interface.encodeFunctionData('add_reward', [reward.address, distributor.address])
        );

      await reward.connect(distributor).approve(gauge.address, rewardAmount);
      await gauge.connect(distributor).deposit_reward_token(reward.address, rewardAmount);
      await advanceToTimestamp((await currentTimestamp()).add(WEEK));
    });

    itTransfersRewardsToClaimer();
  });
});
