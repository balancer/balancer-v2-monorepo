/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { expect } from 'chai';
import {
  expectChainedReferenceContents,
  setChainedReferenceContents,
  toChainedReference,
} from './helpers/chainedReferences';
import { BalancerMinterAuthorization } from '@balancer-labs/balancer-js/src/utils/signatures';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('GaugeActions', function () {
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;
  let admin: SignerWithAddress, userSender: SignerWithAddress, other: SignerWithAddress;

  let gaugeController: Contract, balMinter: Contract, veBalDelegationProxy: Contract;
  let adaptorEntrypoint: Contract;
  let BAL: Contract, veBAL: Contract, rewardToken: Contract, lpToken: Contract;

  let liquidityGaugeFactory: Contract, childChainGaugeFactory: Contract;
  let gauge: Contract;

  const totalLpTokens = fp(100);

  before('get signers', async () => {
    [, admin, userSender, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token mocks', async () => {
    vault = await Vault.create({ admin });
    adaptorEntrypoint = vault.authorizerAdaptorEntrypoint;

    BAL = await deploy('v2-liquidity-mining/TestBalancerToken', {
      args: [admin.address, 'Balancer', 'BAL'],
    });

    veBAL = await deploy('v2-liquidity-mining/TestBalancerToken', {
      args: [admin.address, 'Balancer Voting Escrow', 'veBAL'],
    });

    rewardToken = await deploy('v2-liquidity-mining/TestBalancerToken', {
      args: [admin.address, 'Reward', 'RWT'],
    });

    lpToken = await deploy('v2-pool-utils/MockBalancerPoolToken', {
      args: ['Mock Balancer Pool Token', 'BPT', vault.address],
    });

    await lpToken.mint(userSender.address, totalLpTokens);
  });

  sharedBeforeEach('set up relayer', async () => {
    const adaptor = vault.authorizerAdaptor;
    gaugeController = await deploy('v2-liquidity-mining/MockGaugeController', {
      args: [veBAL.address, adaptor.address],
    });
    // Type weight is ignored in the mock controller.
    await gaugeController.add_type('Ethereum', 0);

    const balTokenAdmin = await deploy('v2-liquidity-mining/MockBalancerTokenAdmin', {
      args: [vault.address, BAL.address],
    });
    await BAL.connect(admin).grantRole(await BAL.MINTER_ROLE(), balTokenAdmin.address);

    balMinter = await deploy('v2-liquidity-mining/MainnetBalancerMinter', {
      args: [balTokenAdmin.address, gaugeController.address],
    });

    // Deploy Relayer: vault and BAL minter are required; we can skip wstETH.
    const isL2Relayer = false;
    ({ relayerLibrary, relayer } = await deployRelayer(isL2Relayer));
  });

  sharedBeforeEach('set up liquidity gauge factory', async () => {
    const adaptor = vault.authorizerAdaptor;
    const veBalDelegation = await deploy('v2-liquidity-mining/MockVeDelegation');

    veBalDelegationProxy = await deploy('v2-liquidity-mining/VotingEscrowDelegationProxy', {
      args: [vault.address, veBAL.address, veBalDelegation.address],
    });

    const liquidityGaugeImplementation = await deploy('v2-liquidity-mining/LiquidityGaugeV5', {
      args: [balMinter.address, veBalDelegationProxy.address, adaptor.address],
    });
    liquidityGaugeFactory = await deploy('v2-liquidity-mining/LiquidityGaugeFactory', {
      args: [liquidityGaugeImplementation.address],
    });
  });

  sharedBeforeEach('set up child chain liquiidity gauge factory', async () => {
    const adaptor = vault.authorizerAdaptor;
    const rewardsOnlyGaugeImplementation = await deploy('v2-liquidity-mining/RewardsOnlyGauge', {
      args: [BAL.address, vault.address, adaptor.address],
    });

    const streamer = await deploy('v2-liquidity-mining/ChildChainStreamer', { args: [BAL.address, adaptor.address] });
    childChainGaugeFactory = await deploy('v2-liquidity-mining/ChildChainLiquidityGaugeFactory', {
      args: [rewardsOnlyGaugeImplementation.address, streamer.address],
    });
  });

  async function deployRelayer(isL2Relayer: boolean): Promise<{ relayerLibrary: Contract; relayer: Contract }> {
    const relayerLibrary = await deploy('MockBatchRelayerLibrary', {
      args: [vault.address, ZERO_ADDRESS, balMinter.address, isL2Relayer],
    });
    const relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['setRelayerApproval', 'manageUserBalance'].map((action) => actionId(vault.instance, action))
    );
    await Promise.all(relayerActionIds.map((action) => vault.grantPermissionGlobally(action, relayer)));

    // Approve relayer by BPT holder
    await vault.setRelayerApproval(userSender, relayer, true);

    return { relayerLibrary, relayer };
  }

  describe('Liquidity gauge', () => {
    sharedBeforeEach(async () => {
      const tx = await liquidityGaugeFactory.create(lpToken.address, fp(1)); // No weight cap.
      gauge = await deployedAt(
        'v2-liquidity-mining/LiquidityGaugeV5',
        expectEvent.inReceipt(await tx.wait(), 'GaugeCreated').args.gauge
      );

      await gaugeController.add_gauge(gauge.address, 0); // Type: Ethereum in mock controller.
    });

    itTestsDepositsAndWithdrawals();

    describe('gaugeMint', () => {
      sharedBeforeEach('stake BPT in gauge and mock votes in the controller', async () => {
        await lpToken.connect(userSender).approve(gauge.address, MAX_UINT256);
        await gauge.connect(userSender)['deposit(uint256)'](await lpToken.balanceOf(userSender.address));
        await gaugeController.setGaugeWeight(gauge.address, fp(1));
      });

      context('when caller is approved to mint', () => {
        let encodedGaugeSetMinterApproval: string;

        sharedBeforeEach('grant mint approval to sender via relayer', async () => {
          const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
            balMinter,
            relayer.address,
            true,
            userSender
          );

          encodedGaugeSetMinterApproval = encodeGaugeSetMinterApproval({
            approval: true,
            user: userSender,
            deadline,
            v,
            r,
            s,
          });
        });

        // We just check the transfer and its 'from' / 'to' attributes; the actual amount depends on the gauge votes
        // which is mocked and out of scope of this test.
        context('when not using output references', () => {
          it('mints BAL to sender', async () => {
            const tx = await relayer
              .connect(userSender)
              .multicall([
                encodedGaugeSetMinterApproval,
                encodeGaugeMint({ gauges: [gauge.address], outputReference: bn(0) }),
              ]);
            expectTransferEvent(await tx.wait(), { from: ZERO_ADDRESS, to: userSender.address }, BAL.address);
          });
        });

        context('when using output references', () => {
          const outputReference = toChainedReference(174);

          it('mints BAL to sender', async () => {
            const tx = await relayer
              .connect(userSender)
              .multicall([
                encodedGaugeSetMinterApproval,
                encodeGaugeMint({ gauges: [gauge.address], outputReference }),
              ]);
            expectTransferEvent(await tx.wait(), { from: ZERO_ADDRESS, to: userSender.address }, BAL.address);
          });

          it('stores the output in a chained reference', async () => {
            const tx = await relayer
              .connect(userSender)
              .multicall([
                encodedGaugeSetMinterApproval,
                encodeGaugeMint({ gauges: [gauge.address], outputReference }),
              ]);
            const event = expectEvent.inIndirectReceipt(await tx.wait(), gauge.interface, 'Transfer');
            const transferValue = event.args._value;
            await expectChainedReferenceContents(relayer, outputReference, transferValue);
          });
        });
      });

      context('when caller is not approved to mint', () => {
        it('reverts', async () => {
          expect(
            relayer.connect(other).multicall([encodeGaugeMint({ gauges: [gauge.address], outputReference: bn(0) })])
          ).to.be.revertedWith('Caller not allowed to mint for user');
        });
      });
    });

    describe('gaugeClaimRewards', () => {
      sharedBeforeEach('setup and deposit reward tokens in gauge', async () => {
        const action = await actionId(adaptorEntrypoint, 'add_reward', gauge.interface);
        await vault.grantPermissionGlobally(action, admin);

        const rewardAmount = fp(500);
        await rewardToken.connect(admin).mint(admin.address, rewardAmount);
        await rewardToken.connect(admin).approve(gauge.address, rewardAmount);

        const calldata = gauge.interface.encodeFunctionData('add_reward', [rewardToken.address, admin.address]);
        await adaptorEntrypoint.connect(admin).performAction(gauge.address, calldata);
        await gauge.connect(admin).deposit_reward_token(rewardToken.address, rewardAmount);
      });

      sharedBeforeEach('stake BPT in gauge', async () => {
        await lpToken.connect(userSender).approve(gauge.address, MAX_UINT256);
        await gauge.connect(userSender)['deposit(uint256)'](await lpToken.balanceOf(userSender.address));
      });

      it('transfers rewards to sender', async () => {
        const tx = await relayer.connect(userSender).multicall([encodeGaugeClaimRewards({ gauges: [gauge.address] })]);
        expectTransferEvent(await tx.wait(), { from: gauge.address, to: userSender.address }, rewardToken.address);
      });
    });

    describe('gaugeCheckpoint - L1', () => {
      let gauges: Contract[];

      sharedBeforeEach('create more than one gauge', async () => {
        const tx = await liquidityGaugeFactory.create(lpToken.address, fp(1)); // No weight cap.
        const otherGauge = await deployedAt(
          'v2-liquidity-mining/LiquidityGaugeV5',
          expectEvent.inReceipt(await tx.wait(), 'GaugeCreated').args.gauge
        );
        gauges = [gauge, otherGauge];
      });

      sharedBeforeEach('stake BPT in gauges', async () => {
        await lpToken.connect(userSender).approve(gauge.address, MAX_UINT256);
        await Promise.all(gauges.map((gauge) => lpToken.connect(userSender).approve(gauge.address, MAX_UINT256)));
        const stakePerGauge = (await lpToken.balanceOf(userSender.address)).div(gauges.length);
        await Promise.all(gauges.map((gauge) => gauge.connect(userSender)['deposit(uint256)'](stakePerGauge)));
      });

      it('can call user checkpoint: false', async () => {
        expect(await relayerLibrary.canCallUserCheckpoint()).to.be.false;
      });

      function itCheckpointsGauges(value: BigNumber) {
        it('checkpoints the gauges when the user has a stake', async () => {
          const receipt = await (
            await relayer.multicall(
              [encodeGaugeCheckpoint({ user: userSender, gauges: gauges.map((gauge) => gauge.address) })],
              { value }
            )
          ).wait();

          // We expect two update liquidity events per gauge, since in the L1 the checkpoint is accomplished
          // by transferring 1 wei from the user to itself, and both the 'withdrawal' and the 'deposit' trigger a
          // checkpoint. Then, since it's the same user who 'withdraws' and 'deposits' in the same transfer, we get
          // two events.
          expectEvent.inIndirectReceipt(
            receipt,
            gauge.interface,
            'UpdateLiquidityLimit',
            {
              user: userSender.address,
            },
            gauges[0].address,
            2
          );

          expectEvent.inIndirectReceipt(
            receipt,
            gauge.interface,
            'UpdateLiquidityLimit',
            {
              user: userSender.address,
            },
            gauges[1].address,
            2
          );
        });
      }

      context('when no value is forwarded in the multicall', () => {
        itCheckpointsGauges(fp(0));
      });

      context('when value is forwarded in the multicall', () => {
        itCheckpointsGauges(fp(1));
      });

      it('reverts when the user does not have a stake', async () => {
        await gauge.connect(userSender)['withdraw(uint256)'](await gauge.balanceOf(userSender.address));
        await expect(
          relayer.multicall([encodeGaugeCheckpoint({ user: userSender, gauges: [gauge.address] })])
        ).to.be.revertedWith('LOW_LEVEL_CALL_FAILED');
      });

      it('reverts when the user has not approved the relayer', async () => {
        await gauge.connect(userSender)['withdraw(uint256)'](await gauge.balanceOf(userSender.address));
        await expect(
          relayer.multicall([encodeGaugeCheckpoint({ user: other.address, gauges: [gauge.address] })])
        ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
      });
    });

    describe('gaugeCheckpoint - L2', () => {
      let gauges: Contract[];
      let relayer: Contract, relayerLibrary: Contract, childChainGaugeFactory: Contract;
      let user: string;

      sharedBeforeEach('create relayer configured for L2', async () => {
        const isL2Relayer = true;
        ({ relayerLibrary, relayer } = await deployRelayer(isL2Relayer));
        user = userSender.address;
      });

      sharedBeforeEach('create child chain gauges', async () => {
        const version = 'test';
        const childChainGaugeImplementation = await deploy('v2-liquidity-mining/ChildChainGauge', {
          args: [veBalDelegationProxy.address, balMinter.address, vault.authorizerAdaptor.address, version],
        });

        childChainGaugeFactory = await deploy('v2-liquidity-mining/ChildChainGaugeFactory', {
          args: [childChainGaugeImplementation.address, version, version],
        });
      });

      sharedBeforeEach('create more than one gauge', async () => {
        let tx = await childChainGaugeFactory.create(lpToken.address);
        const gauge0 = await deployedAt(
          'v2-liquidity-mining/ChildChainGauge',
          expectEvent.inReceipt(await tx.wait(), 'GaugeCreated').args.gauge
        );

        tx = await childChainGaugeFactory.create(lpToken.address);
        const gauge1 = await deployedAt(
          'v2-liquidity-mining/ChildChainGauge',
          expectEvent.inReceipt(await tx.wait(), 'GaugeCreated').args.gauge
        );
        gauges = [gauge0, gauge1];
      });

      it('can call user checkpoint: true', async () => {
        expect(await relayerLibrary.canCallUserCheckpoint()).to.be.true;
      });

      function itCheckpointsGauges(value: BigNumber) {
        // `user_checkpoint` is permissionless for child chain gauges, so the relayer calls it directly.
        // We expect only one liquidity limit update per gauge, and we don't need the user to have a stake in it.
        // Also, since we are not managing user balances using the relayer we don't need user approval for it.
        it('checkpoints the gauges when the user has a stake', async () => {
          const receipt = await (
            await relayer.multicall([encodeGaugeCheckpoint({ user, gauges: gauges.map((gauge) => gauge.address) })], {
              value,
            })
          ).wait();

          expectEvent.inIndirectReceipt(
            receipt,
            gauge.interface,
            'UpdateLiquidityLimit',
            {
              user,
            },
            gauges[0].address,
            1
          );

          expectEvent.inIndirectReceipt(
            receipt,
            gauge.interface,
            'UpdateLiquidityLimit',
            {
              user,
            },
            gauges[1].address,
            1
          );
        });
      }

      context('when no value is forwarded in the multicall', () => {
        itCheckpointsGauges(fp(0));
      });

      context('when value is forwarded in the multicall', () => {
        itCheckpointsGauges(fp(1));
      });

      context('when the user has not approved the relayer', () => {
        sharedBeforeEach(async () => {
          user = other.address;
        });

        itCheckpointsGauges(fp(0));
      });
    });
  });

  describe('Rewards only gauge', () => {
    sharedBeforeEach(async () => {
      const tx = await childChainGaugeFactory.create(lpToken.address);
      gauge = await deployedAt(
        'v2-liquidity-mining/RewardsOnlyGauge',
        expectEvent.inReceipt(await tx.wait(), 'RewardsOnlyGaugeCreated').args.gauge
      );

      await gaugeController.add_gauge(gauge.address, 0); // Type: Ethereum in mock controller.
    });

    itTestsDepositsAndWithdrawals();

    describe('gaugeClaimRewards', () => {
      let streamer: Contract;

      sharedBeforeEach('get deployed streamer', async () => {
        streamer = await deployedAt(
          'v2-liquidity-mining/ChildChainStreamer',
          await childChainGaugeFactory.getPoolStreamer(lpToken.address)
        );
      });

      sharedBeforeEach('stake BPT in gauge', async () => {
        await lpToken.connect(userSender).approve(gauge.address, MAX_UINT256);
        await gauge.connect(userSender)['deposit(uint256)'](await lpToken.balanceOf(userSender.address));
      });

      sharedBeforeEach('send tokens to streamer', async () => {
        await BAL.connect(admin).mint(streamer.address, fp(500));
        await streamer.notify_reward_amount(BAL.address);
      });

      it('first transfers rewards to gauge', async () => {
        const tx = await relayer.connect(userSender).multicall([encodeGaugeClaimRewards({ gauges: [gauge.address] })]);
        expectTransferEvent(await tx.wait(), { from: streamer.address, to: gauge.address }, BAL.address);
      });

      it('then transfers rewards to sender', async () => {
        const tx = await relayer.connect(userSender).multicall([encodeGaugeClaimRewards({ gauges: [gauge.address] })]);
        expectTransferEvent(await tx.wait(), { from: gauge.address, to: userSender.address }, BAL.address);
      });
    });
  });

  function itTestsDepositsAndWithdrawals() {
    describe('gaugeDeposit', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('when using relayer library directly', () => {
        it('reverts', async () => {
          expect(
            relayerLibrary.connect(userSender).gaugeDeposit(gauge.address, userSender.address, gauge.address, fp(1))
          ).to.be.revertedWith('Incorrect sender');
        });
      });

      context('when caller != sender and sender != relayer', () => {
        it('reverts', async () => {
          expect(
            relayer
              .connect(other)
              .multicall([encodeDeposit({ gauge: gauge, sender: userSender, recipient: userSender, amount: fp(1) })])
          ).to.be.revertedWith('IncorrectSender');
        });
      });

      context('when sender does not have enough BPT', () => {
        it('reverts', async () => {
          expect(
            relayer.connect(userSender).multicall([
              encodeDeposit({
                gauge: gauge,
                sender: userSender,
                recipient: userSender,
                amount: totalLpTokens.add(1),
              }),
            ])
          ).to.be.reverted;
        });
      });

      context('when sender has enough BPT', () => {
        context('sender = user, recipient = user', () => {
          sharedBeforeEach(async () => {
            tokenSender = userSender;
            tokenRecipient = userSender;
          });

          itDepositsWithEnoughTokens();
        });

        context('sender = user, recipient = relayer', () => {
          sharedBeforeEach(async () => {
            tokenSender = userSender;
            tokenRecipient = relayer;
          });

          itDepositsWithEnoughTokens();
        });

        context('sender = relayer, recipient = user', () => {
          sharedBeforeEach(async () => {
            await lpToken.connect(userSender).transfer(relayer.address, totalLpTokens);
            tokenSender = relayer;
            tokenRecipient = userSender;
          });

          itDepositsWithEnoughTokens();
        });

        context('sender = relayer, recipient = relayer', () => {
          sharedBeforeEach(async () => {
            await lpToken.connect(userSender).transfer(relayer.address, totalLpTokens);
            tokenSender = relayer;
            tokenRecipient = relayer;
          });

          itDepositsWithEnoughTokens();
        });
      });

      function itDepositsWithEnoughTokens() {
        context('when depositing some of the tokens', () => {
          itDepositsWithRefsAndAmounts(totalLpTokens.div(3));
        });

        context('when depositing all of the available tokens', () => {
          itDepositsWithRefsAndAmounts(totalLpTokens);
        });

        context('when depositing 0 tokens', () => {
          itDepositsWithRefsAndAmounts(bn(0));
        });
      }

      function itDepositsWithRefsAndAmounts(amount: BigNumber) {
        context('when using immediate amounts', () => {
          itDepositsTokens(amount, amount);
        });

        context('when using chained references', () => {
          const reference = toChainedReference(123);

          sharedBeforeEach('set chained reference', async () => {
            await setChainedReferenceContents(relayer, reference, amount);
          });

          itDepositsTokens(reference, amount);
        });
      }

      function itDepositsTokens(depositAmountOrRef: BigNumber, expectedAmount: BigNumber) {
        let receipt: ContractReceipt;
        let tokenSenderAddress: string;
        let tokenRecipientAddress: string;

        const lptBalances: Balances = { sender: {}, recipient: {}, gauge: {} };
        const gaugeBalances: Balances = { sender: {}, recipient: {}, gauge: {} };

        sharedBeforeEach('get addresses', async () => {
          tokenSenderAddress = TypesConverter.toAddress(tokenSender);
          tokenRecipientAddress = TypesConverter.toAddress(tokenRecipient);
        });

        sharedBeforeEach('check initial balances and make deposit', async () => {
          lptBalances.sender.before = await lpToken.balanceOf(tokenSenderAddress);
          lptBalances.gauge.before = await lpToken.balanceOf(gauge.address);

          gaugeBalances.recipient.before = await gauge.balanceOf(tokenRecipientAddress);

          const tx = await relayer.connect(userSender).multicall([
            encodeDeposit({
              gauge: gauge,
              sender: tokenSenderAddress,
              recipient: tokenRecipientAddress,
              amount: depositAmountOrRef,
            }),
          ]);
          receipt = await tx.wait();
        });

        it('pulls BPT tokens from sender if necessary', async () => {
          // This transfer is skipped if token sender is relayer or if 0 tokens are expected to be transferred.
          if (tokenSenderAddress != relayer.address && expectedAmount.gt(0)) {
            expectTransferEvent(
              receipt,
              { from: tokenSenderAddress, to: relayer.address, value: expectedAmount },
              lpToken.address
            );
          }
        });

        it("approves gauge to use relayer's BPT funds", async () => {
          expectEvent.inIndirectReceipt(receipt, lpToken.interface, 'Approval', {
            owner: relayer.address,
            spender: gauge.address,
            value: expectedAmount,
          });
        });

        it('emits BPT transfer event from relayer to gauge if necessary', async () => {
          // This transfer is skipped if 0 tokens are expected to be transferred.
          if (expectedAmount.gt(0)) {
            expectTransferEvent(
              receipt,
              { from: relayer.address, to: gauge.address, value: expectedAmount },
              lpToken.address
            );
          }
        });

        it('transfers BPT tokens to gauge', async () => {
          lptBalances.sender.after = await lpToken.balanceOf(tokenSenderAddress);
          lptBalances.gauge.after = await lpToken.balanceOf(gauge.address);

          expect(lptBalances.sender.after!.sub(lptBalances.sender.before!)).to.be.almostEqual(expectedAmount.mul(-1));
          expect(lptBalances.gauge.after!.sub(lptBalances.gauge.before!)).to.be.almostEqual(expectedAmount);
        });

        it('emits deposit event', async () => {
          expectEvent.inIndirectReceipt(receipt, gauge.interface, 'Deposit', {
            provider: tokenRecipientAddress,
            value: expectedAmount,
          });
        });

        it('mints gauge tokens to recipient', async () => {
          gaugeBalances.recipient.after = await gauge.balanceOf(tokenRecipientAddress);
          expect(gaugeBalances.recipient.after!.sub(gaugeBalances.recipient.before!)).to.be.almostEqual(expectedAmount);
        });

        it('emits transfer event for minted gauge tokens', async () => {
          expectTransferEvent(
            receipt,
            { from: ZERO_ADDRESS, to: tokenRecipientAddress, value: expectedAmount },
            gauge.address
          );
        });
      }
    });

    describe('gaugeWithdraw', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('when using relayer library directly', () => {
        it('reverts', async () => {
          expect(
            relayerLibrary.connect(userSender).gaugeWithdraw(gauge.address, userSender.address, gauge.address, fp(1))
          ).to.be.revertedWith('Incorrect sender');
        });
      });

      context('when caller != sender and sender != relayer', () => {
        it('reverts', async () => {
          expect(
            relayer
              .connect(other)
              .multicall([encodeWithdraw({ gauge: gauge, sender: userSender, recipient: userSender, amount: fp(1) })])
          ).to.be.revertedWith('Incorrect sender');
        });
      });

      context('when sender does not have enough gauge tokens', () => {
        it('reverts', async () => {
          expect(
            relayer.connect(userSender).multicall([
              encodeWithdraw({
                gauge: gauge,
                sender: userSender,
                recipient: userSender,
                amount: totalLpTokens.add(1),
              }),
            ])
          ).to.be.reverted;
        });
      });

      context('when sender has enough gauge tokens', () => {
        context('sender = user, recipient = user', () => {
          sharedBeforeEach(async () => {
            tokenSender = userSender;
            tokenRecipient = userSender;
          });

          itWithdrawsWithEnoughTokens();
        });

        context('sender = user, recipient = relayer', () => {
          sharedBeforeEach(async () => {
            tokenSender = userSender;
            tokenRecipient = relayer;
          });

          itWithdrawsWithEnoughTokens();
        });

        context('sender = relayer, recipient = user', () => {
          sharedBeforeEach(async () => {
            tokenSender = relayer;
            tokenRecipient = userSender;
          });

          itWithdrawsWithEnoughTokens();
        });

        context('sender = relayer, recipient = relayer', () => {
          sharedBeforeEach(async () => {
            tokenSender = relayer;
            tokenRecipient = relayer;
          });

          itWithdrawsWithEnoughTokens();
        });
      });

      function itWithdrawsWithEnoughTokens() {
        context('when withdrawing some of the tokens', () => {
          itWithdrawsWithRefsAndAmounts(totalLpTokens.div(3));
        });

        context('when withdrawing all the available tokens', () => {
          itWithdrawsWithRefsAndAmounts(totalLpTokens);
        });

        context('when withdrawing 0 tokens', () => {
          itWithdrawsWithRefsAndAmounts(bn(0));
        });
      }

      function itWithdrawsWithRefsAndAmounts(amount: BigNumber) {
        context('when using immediate amounts', () => {
          itWithdrawsTokens(amount, amount);
        });

        context('when using chained references', () => {
          const reference = toChainedReference(123);

          sharedBeforeEach('set chained reference', async () => {
            await setChainedReferenceContents(relayer, reference, amount);
          });

          itWithdrawsTokens(reference, amount);
        });
      }

      function itWithdrawsTokens(withdrawAmountOrRef: BigNumber, expectedAmount: BigNumber) {
        let receipt: ContractReceipt;
        let tokenSenderAddress: string;
        let tokenRecipientAddress: string;

        const lptBalances: Balances = { sender: {}, recipient: {}, gauge: {} };
        const gaugeBalances: Balances = { sender: {}, recipient: {}, gauge: {} };

        sharedBeforeEach('get addresses', async () => {
          tokenSenderAddress = TypesConverter.toAddress(tokenSender);
          tokenRecipientAddress = TypesConverter.toAddress(tokenRecipient);
        });

        // User has BPT, and tokenSender needs gauge tokens to start the test. So here sender is always user,
        // and recipient is tokenSender.
        sharedBeforeEach('make initial deposit', async () => {
          await relayer
            .connect(userSender)
            .multicall([
              encodeDeposit({ gauge: gauge, sender: userSender, recipient: tokenSender, amount: totalLpTokens }),
            ]);
        });

        sharedBeforeEach('check initial balances and withdraw', async () => {
          lptBalances.sender.before = await lpToken.balanceOf(tokenSenderAddress);
          lptBalances.recipient.before = await lpToken.balanceOf(tokenRecipientAddress);
          lptBalances.gauge.before = await lpToken.balanceOf(gauge.address);

          gaugeBalances.sender.before = await gauge.balanceOf(tokenSenderAddress);

          const tx = await relayer.connect(userSender).multicall([
            encodeWithdraw({
              gauge: gauge,
              sender: tokenSender,
              recipient: tokenRecipient,
              amount: withdrawAmountOrRef,
            }),
          ]);

          receipt = await tx.wait();
        });

        it('pulls gauge tokens from sender if necessary', async () => {
          // This transfer is skipped if token sender is relayer or if 0 tokens are expected to be transferred.
          if (tokenSenderAddress != relayer.address && expectedAmount.gt(0)) {
            expectTransferEvent(
              receipt,
              { from: tokenSenderAddress, to: relayer.address, value: expectedAmount },
              gauge.address
            );
          }
        });

        it('emits BPT transfer event from gauge to relayer if necessary', async () => {
          // This transfer is skipped if 0 tokens are expected to be transferred.
          if (expectedAmount.gt(0)) {
            expectTransferEvent(
              receipt,
              { from: gauge.address, to: relayer.address, value: expectedAmount },
              lpToken.address
            );
          }
        });

        it('emits withdraw event', async () => {
          expectEvent.inIndirectReceipt(receipt, gauge.interface, 'Withdraw', {
            provider: relayer.address,
            value: expectedAmount,
          });
        });

        it('burns gauge tokens', async () => {
          gaugeBalances.sender.after = await gauge.balanceOf(tokenSenderAddress);
          // Burns expectedAmount.
          expect(gaugeBalances.sender.after!.sub(gaugeBalances.sender.before!)).to.be.almostEqual(
            expectedAmount.mul(-1)
          );
        });

        it('emits transfer event for burned gauge tokens', async () => {
          expectTransferEvent(
            receipt,
            { from: relayer.address, to: ZERO_ADDRESS, value: expectedAmount },
            gauge.address
          );
        });

        it('emits BPT transfer event from relayer to recipient if necessary', async () => {
          // This transfer is skipped if token recipient is relayer.
          if (tokenRecipientAddress != relayer.address) {
            expectTransferEvent(
              receipt,
              { from: relayer.address, to: tokenRecipientAddress, value: expectedAmount },
              lpToken.address
            );
          }
        });

        it('transfers BPT tokens to recipient', async () => {
          lptBalances.sender.after = await lpToken.balanceOf(tokenSenderAddress);
          lptBalances.recipient.after = await lpToken.balanceOf(tokenRecipientAddress);
          lptBalances.gauge.after = await lpToken.balanceOf(gauge.address);

          if (tokenRecipientAddress == tokenSenderAddress) {
            expect(lptBalances.sender.after!.sub(lptBalances.sender.before!)).to.be.almostEqual(expectedAmount);
          } else {
            expect(lptBalances.sender.after!.sub(lptBalances.sender.before!)).to.be.almostEqual(0);
          }
          expect(lptBalances.recipient.after!.sub(lptBalances.recipient.before!)).to.be.almostEqual(expectedAmount);
          expect(lptBalances.gauge.after!.sub(lptBalances.gauge.before!)).to.be.almostEqual(expectedAmount.mul(-1));
        });
      }
    });
  }

  type Balances = {
    sender: {
      before?: BigNumber;
      after?: BigNumber;
    };
    recipient: {
      before?: BigNumber;
      after?: BigNumber;
    };
    gauge: {
      before?: BigNumber;
      after?: BigNumber;
    };
  };

  function encodeDeposit(params: {
    gauge: Contract;
    sender: Account;
    recipient: Account;
    amount: BigNumberish;
  }): string {
    return relayerLibrary.interface.encodeFunctionData('gaugeDeposit', [
      params.gauge.address,
      TypesConverter.toAddress(params.sender),
      TypesConverter.toAddress(params.recipient),
      params.amount,
    ]);
  }

  function encodeWithdraw(params: {
    gauge: Contract;
    sender: Account;
    recipient: Account;
    amount: BigNumberish;
  }): string {
    return relayerLibrary.interface.encodeFunctionData('gaugeWithdraw', [
      params.gauge.address,
      TypesConverter.toAddress(params.sender),
      TypesConverter.toAddress(params.recipient),
      params.amount,
    ]);
  }

  function encodeGaugeSetMinterApproval(params: {
    approval: boolean;
    user: SignerWithAddress;
    deadline: BigNumber;
    v: number;
    r: string;
    s: string;
  }): string {
    return relayerLibrary.interface.encodeFunctionData('gaugeSetMinterApproval', [
      params.approval,
      params.user.address,
      params.deadline,
      params.v,
      params.r,
      params.s,
    ]);
  }

  function encodeGaugeMint(params: { gauges: string[]; outputReference: BigNumber }): string {
    return relayerLibrary.interface.encodeFunctionData('gaugeMint', [params.gauges, params.outputReference]);
  }

  function encodeGaugeClaimRewards(params: { gauges: string[] }): string {
    return relayerLibrary.interface.encodeFunctionData('gaugeClaimRewards', [params.gauges]);
  }

  function encodeGaugeCheckpoint(params: { user: Account; gauges: string[] }): string {
    return relayerLibrary.interface.encodeFunctionData('gaugeCheckpoint', [
      TypesConverter.toAddress(params.user),
      params.gauges,
    ]);
  }
});
