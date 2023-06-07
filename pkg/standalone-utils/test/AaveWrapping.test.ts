import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import {
  expectChainedReferenceContents,
  setChainedReferenceContents,
  toChainedReference,
} from './helpers/chainedReferences';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('AaveWrapping', function () {
  let token: Contract, aToken: Contract;
  let user: SignerWithAddress, other: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;
  let staticToken: Contract;
  let tokenRecipient: Account;

  const totalTokens = fp(100);

  before('setup signer', async () => {
    [, admin, user, other] = await ethers.getSigners();
    // Methods under test don't take a different path based on the recipient, so a fixed one shall be used.
    tokenRecipient = other;
  });

  sharedBeforeEach('deploy and tokens', async () => {
    vault = await Vault.create({ admin });

    token = await deploy('v2-solidity-utils/TestToken', { args: ['Test token', 'TST', 18] });
    aToken = await deploy('v2-solidity-utils/TestToken', { args: ['Test aToken', 'aTST', 18] });
    staticToken = await deploy('MockStaticATokenLM', {
      args: ['Static A Token', 'staTST', token.address, aToken.address],
    });
  });

  sharedBeforeEach('mint tokens and give vault allowance', async () => {
    await token.mint(user.address, totalTokens);
    await aToken.mint(user.address, totalTokens);

    await token.connect(user).approve(vault.address, totalTokens);
    await aToken.connect(user).approve(vault.address, totalTokens);
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Relayer
    relayerLibrary = await deploy('MockBatchRelayerLibrary', {
      args: [vault.address, ZERO_ADDRESS, ZERO_ADDRESS, false],
    });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['setRelayerApproval', 'manageUserBalance'].map((action) => actionId(vault.instance, action))
    );
    await Promise.all(relayerActionIds.map((action) => vault.grantPermissionGlobally(action, relayer)));

    // Approve relayer by sender
    await vault.setRelayerApproval(user, relayer, true);
  });

  describe('wrapAaveDynamicToken', () => {
    let tokenSender: Account;
    let fromUnderlying: boolean;
    const referenceSlot = 97;

    context('when caller != sender and sender != relayer', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([encodeWrap(user, tokenRecipient, fp(1), fromUnderlying)])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('from underlying tokens', () => {
      beforeEach(() => {
        fromUnderlying = true;
      });

      itWrapsWithDifferentSenders();
    });

    context('from dynamic aTokens', () => {
      beforeEach(() => {
        fromUnderlying = false;
      });

      itWrapsWithDifferentSenders();
    });

    function itWrapsWithDifferentSenders() {
      context('sender = user', () => {
        beforeEach(() => {
          tokenSender = user;
        });

        itWrapsWithRefsAndAmounts();
      });

      context('sender = relayer', () => {
        beforeEach(() => {
          tokenSender = relayer;
        });

        itWrapsWithRefsAndAmounts();
      });
    }

    function itWrapsWithRefsAndAmounts() {
      const expectedAmount = totalTokens;

      context('using immediate amounts', () => {
        itWraps(expectedAmount, expectedAmount);
      });

      context('using chained references', () => {
        const chainedReference = toChainedReference(referenceSlot);

        sharedBeforeEach(async () => {
          await setChainedReferenceContents(relayer, chainedReference, expectedAmount);
        });

        itWraps(chainedReference, expectedAmount);
      });
    }

    function itWraps(amountOrRef: BigNumber, expectedAmount: BigNumber): void {
      let receipt: ContractReceipt;

      sharedBeforeEach('call wrapAaveDynamicToken', async () => {
        receipt = await (
          await relayer
            .connect(user)
            .multicall([
              encodeWrap(tokenSender, tokenRecipient, amountOrRef, fromUnderlying, toChainedReference(referenceSlot)),
            ])
        ).wait();
      });

      it('pulls tokens if needed', async () => {
        if (TypesConverter.toAddress(tokenSender) != relayer.address) {
          expectTransferEvent(
            receipt,
            { from: TypesConverter.toAddress(tokenSender), to: relayer.address, value: expectedAmount },
            fromUnderlying ? token.address : aToken.address
          );
        }
      });

      it('approves static token to spend dynamic tokens', async () => {
        expectEvent.inIndirectReceipt(receipt, token.interface, 'Approval', {
          owner: relayer.address,
          spender: staticToken.address,
          value: expectedAmount,
        });
      });

      it('deposits dynamic tokens', async () => {
        expectEvent.inIndirectReceipt(receipt, staticToken.interface, 'Deposit', {
          depositor: relayer.address,
          recipient: TypesConverter.toAddress(tokenRecipient),
          amount: expectedAmount,
          referralCode: 0,
          fromUnderlying,
        });
      });

      it('stores wrap output as chained reference', async () => {
        await expectChainedReferenceContents(relayer, toChainedReference(referenceSlot), expectedAmount);
      });
    }
  });

  describe('unwrapAaveDynamicToken', () => {
    let tokenSender: Account;
    let toUnderlying: boolean;
    const referenceSlot = 97;

    sharedBeforeEach('mock token wrap', async () => {
      await staticToken.mint(user.address, totalTokens);
      await staticToken.connect(user).approve(vault.address, totalTokens);
    });

    context('when caller != sender and sender != relayer', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([encodeUnwrap(user, tokenRecipient, fp(1), toUnderlying)])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('to underlying tokens', () => {
      beforeEach(() => {
        toUnderlying = true;
      });

      itUnwrapsWithDifferentSenders();
    });

    context('to dynamic aTokens', () => {
      beforeEach(() => {
        toUnderlying = false;
      });

      itUnwrapsWithDifferentSenders();
    });

    function itUnwrapsWithDifferentSenders() {
      context('sender = user', () => {
        beforeEach(() => {
          tokenSender = user;
        });

        itUnwrapsWithRefsAndAmounts();
      });

      context('sender = relayer', () => {
        beforeEach(() => {
          tokenSender = relayer;
        });

        itUnwrapsWithRefsAndAmounts();
      });
    }

    function itUnwrapsWithRefsAndAmounts() {
      const expectedAmount = totalTokens;

      context('using immediate amounts', () => {
        itUnwraps(expectedAmount, expectedAmount);
      });

      context('using chained references', () => {
        const chainedReference = toChainedReference(referenceSlot);

        sharedBeforeEach(async () => {
          await setChainedReferenceContents(relayer, chainedReference, expectedAmount);
        });

        itUnwraps(chainedReference, expectedAmount);
      });
    }

    function itUnwraps(amountOrRef: BigNumber, expectedAmount: BigNumber): void {
      let receipt: ContractReceipt;

      sharedBeforeEach('call unwrapAaveDynamicToken', async () => {
        receipt = await (
          await relayer
            .connect(user)
            .multicall([
              encodeUnwrap(tokenSender, tokenRecipient, amountOrRef, toUnderlying, toChainedReference(referenceSlot)),
            ])
        ).wait();
      });

      it('pulls static tokens if needed', async () => {
        if (TypesConverter.toAddress(tokenSender) != relayer.address) {
          expectTransferEvent(
            receipt,
            { from: TypesConverter.toAddress(tokenSender), to: relayer.address, value: expectedAmount },
            staticToken.address
          );
        }
      });

      it('withdraws dynamic tokens', async () => {
        const dynamicAmount = await staticToken.staticToDynamicAmount(expectedAmount);
        expectEvent.inIndirectReceipt(receipt, staticToken.interface, 'Withdraw', {
          owner: relayer.address,
          recipient: TypesConverter.toAddress(tokenRecipient),
          staticAmount: expectedAmount,
          dynamicAmount,
          toUnderlying,
        });
      });

      it('stores unwrap output as chained reference', async () => {
        await expectChainedReferenceContents(relayer, toChainedReference(referenceSlot), expectedAmount);
      });
    }
  });

  function encodeWrap(
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    fromUnderlying: boolean,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapAaveDynamicToken', [
      staticToken.address,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      fromUnderlying,
      outputReference ?? 0,
    ]);
  }

  function encodeUnwrap(
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    toUnderlying: boolean,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('unwrapAaveStaticToken', [
      staticToken.address,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      toUnderlying,
      outputReference ?? 0,
    ]);
  }
});
