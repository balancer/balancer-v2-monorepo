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

describe('GaugeActions', function () {
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;
  let admin: SignerWithAddress, userSender: SignerWithAddress, other: SignerWithAddress;

  let adaptor: Contract, gaugeController: Contract, balMinter: Contract;
  let BAL: Contract, veBAL: Contract, rewardToken: Contract, lpToken: Contract;

  let gaugeFactory: Contract;
  let gauge: Contract;

  const totalLpTokens = fp(100);

  before('get signers', async () => {
    [, admin, userSender, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token mocks', async () => {
    vault = await Vault.create({ admin });

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
    adaptor = await deploy('v2-liquidity-mining/AuthorizerAdaptor', { args: [vault.address] });

    gaugeController = await deploy('v2-liquidity-mining/MockGaugeController', {
      args: [veBAL.address, adaptor.address],
    });

    const balTokenAdmin = await deploy('v2-liquidity-mining/MockBalancerTokenAdmin', {
      args: [vault.address, BAL.address],
    });
    await BAL.connect(admin).grantRole(await BAL.MINTER_ROLE(), balTokenAdmin.address);

    balMinter = await deploy('v2-liquidity-mining/BalancerMinter', {
      args: [balTokenAdmin.address, gaugeController.address],
    });

    // Deploy Relayer: vault and BAL minter are required; we can skip wstETH.
    relayerLibrary = await deploy('MockBatchRelayerLibrary', {
      args: [vault.address, ZERO_ADDRESS, balMinter.address],
    });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['setRelayerApproval', 'manageUserBalance'].map((action) => actionId(vault.instance, action))
    );
    await vault.grantPermissionsGlobally(relayerActionIds, relayer);

    // Approve relayer by BPT holder
    await vault.setRelayerApproval(userSender, relayer, true);
  });

  // We won't be needing the adder; we just need a staking liquidity gauge where tokens can be deposited / withdrawn.
  sharedBeforeEach('set up gauge', async () => {
    const veBalDelegation = await deploy('v2-liquidity-mining/MockVeDelegation');

    const veBalDelegationProxy = await deploy('v2-liquidity-mining/VotingEscrowDelegationProxy', {
      args: [vault.address, veBAL.address, veBalDelegation.address],
    });

    const gaugeImplementation = await deploy('v2-liquidity-mining/LiquidityGaugeV5', {
      args: [balMinter.address, veBalDelegationProxy.address, adaptor.address],
    });
    gaugeFactory = await deploy('v2-liquidity-mining/LiquidityGaugeFactory', { args: [gaugeImplementation.address] });

    gauge = await deployedAt(
      'v2-liquidity-mining/LiquidityGaugeV5',
      await deployGauge(gaugeFactory, lpToken.address) // No weight cap.
    );

    // Type weight is ignored in the mock controller.
    await gaugeController.add_type('Ethereum', 0);
    await gaugeController.add_gauge(gauge.address, 0); // Type: Ethereum in mock controller.
  });

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
          relayerLibrary.connect(userSender).gaugeDeposit(gauge.address, other.address, gauge.address, fp(1))
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when sender does not have enough BPT', () => {
      it('reverts', async () => {
        expect(
          relayer
            .connect(userSender)
            .multicall([
              encodeDeposit({ gauge: gauge, sender: userSender, recipient: userSender, amount: totalLpTokens.add(1) }),
            ])
        ).to.be.reverted;
      });
    });

    context('when sender has enough BPT', () => {
      context('sender = senderUser, recipient = senderUser', () => {
        sharedBeforeEach('', async () => {
          tokenSender = userSender;
          tokenRecipient = userSender;
        });

        itDepositsWithEnoughTokens();
      });

      context('sender = senderUser, recipient = relayer', () => {
        sharedBeforeEach('', async () => {
          tokenSender = userSender;
          tokenRecipient = relayer;
        });

        itDepositsWithEnoughTokens();
      });

      context('sender = relayer, recipient = senderUser', () => {
        sharedBeforeEach('', async () => {
          await lpToken.connect(userSender).transfer(relayer.address, totalLpTokens);
          tokenSender = relayer;
          tokenRecipient = userSender;
        });

        itDepositsWithEnoughTokens();
      });

      context('sender = relayer, recipient = relayer', () => {
        sharedBeforeEach('', async () => {
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

      sharedBeforeEach('get addresses', async () => {
        tokenSenderAddress = TypesConverter.toAddress(tokenSender);
        tokenRecipientAddress = TypesConverter.toAddress(tokenRecipient);
      });

      sharedBeforeEach('check initial balances and make deposit', async () => {
        // Start: sender has all the BPT, no gauge tokens minted, recipient is clean unless it is sender.
        expect(await lpToken.balanceOf(gauge.address)).to.be.eq(0);
        expect(await lpToken.balanceOf(tokenSenderAddress)).to.be.eq(totalLpTokens);
        if (tokenSenderAddress != tokenRecipientAddress) {
          expect(await lpToken.balanceOf(tokenRecipientAddress)).to.be.eq(0);
        }

        expect(await gauge.balanceOf(gauge.address)).to.be.eq(0);
        expect(await gauge.balanceOf(tokenSenderAddress)).to.be.eq(0);
        expect(await gauge.balanceOf(tokenRecipientAddress)).to.be.eq(0);

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

      // Short-circuit when no tokens are deposited.
      expectedAmount.gt(0) &&
        it('pulls BPT tokens from sender if necessary', async () => {
          // This transfer is skipped if token sender is relayer, but addresses are undefined outside this scope.
          if (tokenSenderAddress != relayer.address) {
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

      // Short-circuit when no tokens are deposited.
      expectedAmount.gt(0) &&
        it('emits BPT transfer event from relayer to gauge', async () => {
          expectTransferEvent(
            receipt,
            { from: relayer.address, to: gauge.address, value: expectedAmount },
            lpToken.address
          );
        });

      it('transfers BPT tokens to gauge', async () => {
        expect(await lpToken.balanceOf(tokenSenderAddress)).to.be.almostEqual(totalLpTokens.sub(expectedAmount));
        expect(await lpToken.balanceOf(gauge.address)).to.be.eq(expectedAmount);
      });

      it('emits deposit event', async () => {
        expectEvent.inIndirectReceipt(receipt, gauge.interface, 'Deposit', {
          provider: tokenRecipientAddress,
          value: expectedAmount,
        });
      });

      it('mints gauge tokens to recipient', async () => {
        expect(await gauge.balanceOf(tokenRecipientAddress)).to.be.eq(expectedAmount);
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
          relayerLibrary.connect(userSender).gaugeWithdraw(gauge.address, other.address, gauge.address, fp(1))
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when sender does not have enough gauge tokens', () => {
      it('reverts', async () => {
        expect(
          relayer
            .connect(userSender)
            .multicall([
              encodeWithdraw({ gauge: gauge, sender: userSender, recipient: userSender, amount: totalLpTokens.add(1) }),
            ])
        ).to.be.reverted;
      });
    });

    context('when sender has enough gauge tokens', () => {
      context('sender = senderUser, recipient = senderUser', () => {
        sharedBeforeEach('', async () => {
          tokenSender = userSender;
          tokenRecipient = userSender;
        });

        itWithdrawsWithEnoughTokens();
      });

      context('sender = senderUser, recipient = relayer', () => {
        sharedBeforeEach('', async () => {
          tokenSender = userSender;
          tokenRecipient = relayer;
        });

        itWithdrawsWithEnoughTokens();
      });

      context('sender = relayer, recipient = senderUser', () => {
        sharedBeforeEach('', async () => {
          tokenSender = relayer;
          tokenRecipient = userSender;
        });

        itWithdrawsWithEnoughTokens();
      });

      context('sender = relayer, recipient = relayer', () => {
        sharedBeforeEach('', async () => {
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

      sharedBeforeEach('get addresses', async () => {
        tokenSenderAddress = TypesConverter.toAddress(tokenSender);
        tokenRecipientAddress = TypesConverter.toAddress(tokenRecipient);
      });

      // userSender has BPT, and tokenSender needs gauge tokens to start the test, so here sender is always userSender,
      // and recipient is tokenSender.
      sharedBeforeEach('make initial deposit', async () => {
        await relayer
          .connect(userSender)
          .multicall([
            encodeDeposit({ gauge: gauge, sender: userSender, recipient: tokenSender, amount: totalLpTokens }),
          ]);
      });

      sharedBeforeEach('check initial balances and withdraw', async () => {
        // Start: gauge has all the BPT, sender has all the gauge tokens, recipient is clean unless it is sender.
        expect(await lpToken.balanceOf(gauge.address)).to.be.eq(totalLpTokens);
        expect(await lpToken.balanceOf(tokenSenderAddress)).to.be.eq(0);
        expect(await lpToken.balanceOf(tokenRecipientAddress)).to.be.eq(0);

        expect(await gauge.balanceOf(gauge.address)).to.be.eq(0);
        expect(await gauge.balanceOf(tokenSenderAddress)).to.be.eq(totalLpTokens);
        if (tokenSenderAddress != tokenRecipientAddress) {
          expect(await gauge.balanceOf(tokenRecipientAddress)).to.be.eq(0);
        }

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

      // Short-circuit when no tokens are withdrawn.
      expectedAmount.gt(0) &&
        it('pulls gauge tokens from sender if necessary', async () => {
          // This transfer is skipped if token sender is relayer, but addresses are undefined outside this scope.
          if (tokenSenderAddress != relayer.address) {
            expectTransferEvent(
              receipt,
              { from: tokenSenderAddress, to: relayer.address, value: expectedAmount },
              gauge.address
            );
          }
        });

      // Short-circuit when no tokens are withdrawn.
      expectedAmount.gt(0) &&
        it('emits BPT transfer event from gauge to relayer', async () => {
          expectTransferEvent(
            receipt,
            { from: gauge.address, to: relayer.address, value: expectedAmount },
            lpToken.address
          );
        });

      it('emits withdraw event', async () => {
        expectEvent.inIndirectReceipt(receipt, gauge.interface, 'Withdraw', {
          provider: relayer.address,
          value: expectedAmount,
        });
      });

      it('burns gauge tokens', async () => {
        expect(await gauge.balanceOf(tokenSenderAddress)).to.be.almostEqual(totalLpTokens.sub(expectedAmount));
      });

      it('emits transfer event for burned gauge tokens', async () => {
        expectTransferEvent(receipt, { from: relayer.address, to: ZERO_ADDRESS, value: expectedAmount }, gauge.address);
      });

      it('emits BPT transfer event from relayer to recipient if necessary', async () => {
        // This transfer is skipped if token recipient is relayer, but addresses are undefined outside this scope.
        if (tokenRecipientAddress != relayer.address) {
          expectTransferEvent(
            receipt,
            { from: relayer.address, to: tokenRecipientAddress, value: expectedAmount },
            lpToken.address
          );
        }
      });

      it('transfers BPT tokens to recipient', async () => {
        if (tokenRecipientAddress == tokenSenderAddress) {
          expect(await lpToken.balanceOf(tokenSenderAddress)).to.be.eq(expectedAmount);
        } else {
          expect(await lpToken.balanceOf(tokenSenderAddress)).to.be.eq(0);
        }
        expect(await lpToken.balanceOf(tokenRecipientAddress)).to.be.eq(expectedAmount);
        expect(await lpToken.balanceOf(gauge.address)).to.be.almostEqual(totalLpTokens.sub(expectedAmount));
      });
    }
  });

  describe('gaugeMint', () => {
    sharedBeforeEach('grant mint approval to sender via relayer', async () => {
      const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
        balMinter,
        relayer.address,
        true,
        userSender
      );

      await relayer
        .connect(userSender)
        .multicall([encodeGaugeSetMinterApproval({ approval: true, user: userSender, deadline, v, r, s })]);
    });

    sharedBeforeEach('stake BPT in gauge and mock votes in the controller', async () => {
      await lpToken.connect(userSender).approve(gauge.address, MAX_UINT256);
      await gauge.connect(userSender)['deposit(uint256)'](await lpToken.balanceOf(userSender.address));
      await gaugeController.setGaugeWeight(gauge.address, fp(1));
    });

    context('when caller is approved to mint', () => {
      // We just check the transfer and its 'from' / 'to' attributes; the actual amount depends on the gauge votes
      // which is mocked and out of scope of this test.
      context('when not using output references', () => {
        it('mints BAL to sender', async () => {
          const tx = await relayer
            .connect(userSender)
            .multicall([encodeGaugeMint({ gauges: [gauge.address], outputReference: bn(0) })]);
          expectTransferEvent(await tx.wait(), { from: ZERO_ADDRESS, to: userSender.address }, BAL.address);
        });
      });

      context('when using output references', () => {
        const outputReference = toChainedReference(174);

        it('mints BAL to sender', async () => {
          const tx = await relayer
            .connect(userSender)
            .multicall([encodeGaugeMint({ gauges: [gauge.address], outputReference })]);
          expectTransferEvent(await tx.wait(), { from: ZERO_ADDRESS, to: userSender.address }, BAL.address);
        });

        it('stores the output in a chained reference', async () => {
          const tx = await relayer
            .connect(userSender)
            .multicall([encodeGaugeMint({ gauges: [gauge.address], outputReference })]);
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
      const action = await actionId(adaptor, 'add_reward', gauge.interface);
      await vault.grantPermissionsGlobally([action], admin);

      const rewardAmount = fp(500);
      await rewardToken.connect(admin).mint(admin.address, rewardAmount);
      await rewardToken.connect(admin).approve(gauge.address, rewardAmount);

      const calldata = gauge.interface.encodeFunctionData('add_reward', [rewardToken.address, admin.address]);
      await adaptor.connect(admin).performAction(gauge.address, calldata);
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

  async function deployGauge(gaugeFactory: Contract, poolAddress: string): Promise<string> {
    const tx = await gaugeFactory.create(poolAddress, fp(1)); // No weight cap.
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    return event.args.gauge;
  }

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
});
