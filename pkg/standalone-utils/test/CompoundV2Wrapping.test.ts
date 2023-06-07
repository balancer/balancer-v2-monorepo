import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp, bn } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Dictionary } from 'lodash';
import {
  expectChainedReferenceContents,
  setChainedReferenceContents,
  toChainedReference,
} from './helpers/chainedReferences';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('CompoundV2Wrapping', function () {
  let DAI: Contract, cDAI: Contract;
  let senderUser: SignerWithAddress, recipientUser: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;

  before('setup signer', async () => {
    [, admin, senderUser, recipientUser] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });

    DAI = await deploy('v2-solidity-utils/TestToken', { args: ['DAI', 'DAI', 18] });

    cDAI = await deploy('MockCToken', {
      args: ['cDAI', 'cDAI', DAI.address, fp(2)], // exchange rate = 2
    });
  });

  sharedBeforeEach('mint tokens to senderUser', async () => {
    await DAI.mint(senderUser.address, fp(100));
    await DAI.connect(senderUser).approve(vault.address, fp(100));
    await DAI.mint(cDAI.address, fp(100));

    await cDAI.mintTestTokens(senderUser.address, bn(100e8));
    await cDAI.connect(senderUser).approve(vault.address, bn(100e8));
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Relayer
    relayerLibrary = await deploy('MockBatchRelayerLibrary', {
      args: [vault.address, ZERO_ADDRESS, ZERO_ADDRESS, false],
    });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        actionId(vault.instance, action)
      )
    );
    await Promise.all(relayerActionIds.map((action) => vault.grantPermissionGlobally(action, relayer)));

    // Approve relayer by sender
    await vault.setRelayerApproval(senderUser, relayer, true);
  });

  describe('primitives', () => {
    describe('wrapCompoundV2', () => {
      const amount = fp(1);
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(() => {
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      context('sender = senderUser, recipient = senderUser', () => {
        beforeEach(() => {
          tokenSender = senderUser;
          tokenRecipient = senderUser;
        });
        testWrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await DAI.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      context('sender = relayer, recipient = senderUser', () => {
        beforeEach(async () => {
          await DAI.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = senderUser;
        });
        testWrap();
      });

      function testWrap(): void {
        it('wraps with immediate amounts', async () => {
          const expectedWrappedAmount = await cDAI.toCTokenAmount(amount);

          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeWrap(cDAI.address, tokenSender, tokenRecipient, amount)])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          if (!relayerIsSender) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(tokenSender),
                to: TypesConverter.toAddress(relayer),
                value: amount,
              },
              DAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: TypesConverter.toAddress(cDAI),
              value: amount,
            },
            DAI
          );

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: ZERO_ADDRESS,
              to: TypesConverter.toAddress(relayer),
              value: expectedWrappedAmount,
            },
            cDAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: expectedWrappedAmount,
              },
              cDAI
            );
          }
        });

        it('stores wrap output as chained reference', async () => {
          const expectedWrappedAmount = await cDAI.toCTokenAmount(amount);

          await relayer
            .connect(senderUser)
            .multicall([encodeWrap(cDAI.address, tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          await expectChainedReferenceContents(relayer, toChainedReference(0), expectedWrappedAmount);
        });

        it('wraps with chained references', async () => {
          const expectedWrappedAmount = await cDAI.toCTokenAmount(amount);
          await setChainedReferenceContents(relayer, toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeWrap(cDAI.address, tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          if (!relayerIsSender) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(tokenSender),
                to: TypesConverter.toAddress(relayer),
                value: amount,
              },
              DAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: TypesConverter.toAddress(cDAI),
              value: amount,
            },
            DAI
          );

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: ZERO_ADDRESS,
              to: TypesConverter.toAddress(relayer),
              value: expectedWrappedAmount,
            },
            cDAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: expectedWrappedAmount,
              },
              cDAI
            );
          }
        });
      }
    });

    describe('unwrapCompoundV2', () => {
      let tokenSender: Account, tokenRecipient: Account;
      const amount = bn(1e8); // cTokens have 8 decimals

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(async () => {
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = senderUser, recipient = senderUser', () => {
        beforeEach(async () => {
          await cDAI.connect(senderUser).approve(vault.address, fp(10));
          tokenSender = senderUser;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await cDAI.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = senderUser', () => {
        beforeEach(async () => {
          await cDAI.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      function testUnwrap(): void {
        it('unwraps with immediate amounts', async () => {
          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeUnwrap(cDAI.address, tokenSender, tokenRecipient, amount)])
          ).wait();

          const expectedUnwrappedAmount = await cDAI.fromCTokenAmount(amount);

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          if (!relayerIsSender) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(tokenSender),
                to: TypesConverter.toAddress(relayer),
                value: amount,
              },
              cDAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: ZERO_ADDRESS,
              value: amount,
            },
            cDAI
          );

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(cDAI),
              to: TypesConverter.toAddress(relayer),
              value: expectedUnwrappedAmount,
            },
            DAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: expectedUnwrappedAmount,
              },
              DAI
            );
          }
        });

        it('stores unwrap output as chained reference', async () => {
          await relayer
            .connect(senderUser)
            .multicall([encodeUnwrap(cDAI.address, tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          const mainAmount = await cDAI.fromCTokenAmount(amount);
          await expectChainedReferenceContents(relayer, toChainedReference(0), mainAmount);
        });

        it('unwraps with chained references', async () => {
          await setChainedReferenceContents(relayer, toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeUnwrap(cDAI.address, tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          const expectedUnwrappedAmount = await cDAI.fromCTokenAmount(amount);

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          if (!relayerIsSender) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(tokenSender),
                to: TypesConverter.toAddress(relayer),
                value: amount,
              },
              cDAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: ZERO_ADDRESS,
              value: amount,
            },
            cDAI
          );

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(cDAI),
              to: TypesConverter.toAddress(relayer),
              value: expectedUnwrappedAmount,
            },
            DAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: expectedUnwrappedAmount,
              },
              DAI
            );
          }
        });
      }
    });
  });

  describe('complex actions', () => {
    let WETH: Token, DAIToken: Token, cDAIToken: Token;
    let poolTokens: TokenList;
    let poolId: string;
    let pool: WeightedPool;

    sharedBeforeEach('deploy pool', async () => {
      WETH = await Token.deployedAt(await vault.instance.WETH());
      DAIToken = await Token.deployedAt(await DAI.address);
      cDAIToken = await Token.deployedAt(await cDAI.address);
      poolTokens = new TokenList([WETH, cDAIToken]).sort();

      pool = await WeightedPool.create({ tokens: poolTokens, vault });
      poolId = pool.poolId;

      await WETH.mint(senderUser, fp(2));
      await WETH.approve(vault, MAX_UINT256, { from: senderUser });

      await WETH.mint(admin, fp(100));
      await WETH.approve(vault, MAX_UINT256, { from: admin });

      await cDAIToken.mint(admin, bn(100e8));
      await cDAIToken.approve(vault, MAX_UINT256, { from: admin });

      const initialBalances = poolTokens.map((token) => (token === cDAIToken ? bn(100e8) : fp(100)));

      await pool.init({ initialBalances, from: admin });
    });

    describe('swap', () => {
      function encodeSwap(params: {
        poolId: string;
        kind: SwapKind;
        tokenIn: Token | Contract;
        tokenOut: Token | Contract;
        amount: BigNumberish;
        sender: Account;
        recipient: Account;
        outputReference?: BigNumberish;
      }): string {
        return relayerLibrary.interface.encodeFunctionData('swap', [
          {
            poolId: params.poolId,
            kind: params.kind,
            assetIn: params.tokenIn.address,
            assetOut: params.tokenOut.address,
            amount: params.amount,
            userData: '0x',
          },
          {
            sender: TypesConverter.toAddress(params.sender),
            recipient: TypesConverter.toAddress(params.recipient),
            fromInternalBalance: false,
            toInternalBalance: false,
          },
          0,
          MAX_UINT256,
          0,
          params.outputReference ?? 0,
        ]);
      }

      describe('swap using DAI as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap DAI for WETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeWrap(cDAI.address, senderUser.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(cDAI, MAX_UINT256),
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: cDAI,
                tokenOut: WETH,
                amount: toChainedReference(0),
                sender: relayer,
                recipient: recipientUser,
                outputReference: 0,
              }),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: cDAI.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await cDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using DAI as an output', () => {
        let receipt: ContractReceipt;
        const amount = bn(1e8); // cTokens have 8 decimals

        sharedBeforeEach('swap WETH for DAI', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: WETH,
                tokenOut: cDAIToken,
                amount,
                sender: senderUser,
                recipient: relayer,
                outputReference: toChainedReference(0),
              }),
              encodeUnwrap(cDAI.address, relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: WETH.address,
            tokenOut: cDAIToken.address,
          });

          expectTransferEvent(receipt, { from: cDAI.address, to: relayer.address }, DAI);
          if (recipientUser.address !== relayer.address) {
            expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, DAI);
          }
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await cDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

    describe('batchSwap', () => {
      function encodeBatchSwap(params: {
        swaps: Array<{
          poolId: string;
          tokenIn: Token;
          tokenOut: Token;
          amount: BigNumberish;
        }>;
        sender: Account;
        recipient: Account;
        outputReferences?: Dictionary<BigNumberish>;
      }): string {
        const outputReferences = Object.entries(params.outputReferences ?? {}).map(([symbol, key]) => ({
          index: poolTokens.findIndexBySymbol(symbol),
          key,
        }));

        return relayerLibrary.interface.encodeFunctionData('batchSwap', [
          SwapKind.GivenIn,
          params.swaps.map((swap) => ({
            poolId: swap.poolId,
            assetInIndex: poolTokens.indexOf(swap.tokenIn),
            assetOutIndex: poolTokens.indexOf(swap.tokenOut),
            amount: swap.amount,
            userData: '0x',
          })),
          poolTokens.addresses,
          {
            sender: TypesConverter.toAddress(params.sender),
            recipient: TypesConverter.toAddress(params.recipient),
            fromInternalBalance: false,
            toInternalBalance: false,
          },
          new Array(poolTokens.length).fill(MAX_INT256),
          MAX_UINT256,
          0,
          outputReferences,
        ]);
      }

      describe('swap using DAI as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap DAI for WETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeWrap(cDAI.address, senderUser.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(cDAIToken, MAX_UINT256),
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: cDAIToken, tokenOut: WETH, amount: toChainedReference(0) }],
                sender: relayer,
                recipient: recipientUser,
              }),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: cDAI.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await cDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using DAI as an output', () => {
        let receipt: ContractReceipt;
        const amount = bn(1e8); // cTokens have 8 decimals

        sharedBeforeEach('swap WETH for DAI', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: WETH, tokenOut: cDAIToken, amount }],
                sender: senderUser,
                recipient: relayer,
                outputReferences: { cDAI: toChainedReference(0) },
              }),
              encodeUnwrap(cDAI.address, relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: WETH.address,
            tokenOut: cDAI.address,
          });

          expectTransferEvent(receipt, { from: cDAI.address, to: relayer.address }, DAI);
          if (recipientUser.address !== relayer.address) {
            expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, DAI);
          }
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await cDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

    describe('joinPool', () => {
      let receipt: ContractReceipt;
      let sendercDAIBalanceBefore: BigNumber;
      const amount = fp(1);

      sharedBeforeEach('join the pool', async () => {
        const { tokens: allTokens } = await vault.getPoolTokens(await pool.getPoolId());

        sendercDAIBalanceBefore = await cDAIToken.balanceOf(senderUser);
        receipt = await (
          await relayer.connect(senderUser).multicall([
            encodeWrap(cDAI.address, senderUser.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(cDAIToken, MAX_UINT256),
            encodeJoin({
              poolId,
              assets: allTokens,
              sender: relayer,
              recipient: recipientUser,
              maxAmountsIn: Array(poolTokens.length).fill(MAX_UINT256),
              userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                poolTokens.map((token) => (token === cDAIToken ? toChainedReference(0) : 0)),
                0
              ),
            }),
          ])
        ).wait();
      });

      it('joins the pool', async () => {
        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
          poolId,
          liquidityProvider: relayer.address,
        });

        // BPT minted to recipient
        expectTransferEvent(receipt, { from: ZERO_ADDRESS, to: recipientUser.address }, pool);
      });

      it('does not take cDAI from the user', async () => {
        const sendercDAIBalanceAfter = await cDAIToken.balanceOf(senderUser);
        expect(sendercDAIBalanceAfter).to.be.eq(sendercDAIBalanceBefore);
      });

      it('does not leave dust on the relayer', async () => {
        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await cDAIToken.balanceOf(relayer)).to.be.eq(0);
      });
    });

    describe('exitPool', () => {
      let receipt: ContractReceipt;
      let BPTBalanceBefore: BigNumber;
      const amountDAI = fp(1);

      sharedBeforeEach('exit the pool', async () => {
        const { tokens: allTokens } = await vault.getPoolTokens(await pool.getPoolId());

        // First transfer token to the pool, before testing exit
        await relayer.connect(senderUser).multicall([
          encodeWrap(cDAI.address, senderUser.address, relayer.address, amountDAI, toChainedReference(0)),
          encodeApprove(cDAIToken, MAX_UINT256),
          encodeJoin({
            poolId,
            assets: allTokens,
            sender: relayer,
            recipient: senderUser,
            maxAmountsIn: Array(poolTokens.length).fill(MAX_UINT256),
            userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
              poolTokens.map((token) => (token === cDAIToken ? toChainedReference(0) : 0)),
              0
            ),
          }),
        ]);

        const eDAIIndex = poolTokens.tokens.findIndex((token: Token) => token.instance.address === cDAIToken.address);
        const outputReference = poolTokens.map((_, i) => ({ index: i, key: toChainedReference(10 + i) }));
        BPTBalanceBefore = await pool.balanceOf(senderUser);

        receipt = await (
          await relayer.connect(senderUser).multicall([
            encodeApprove(pool.instance, MAX_UINT256),
            encodeExit({
              poolId,
              assets: allTokens,
              sender: senderUser,
              recipient: relayer,
              minAmountsOut: Array(poolTokens.length).fill(0),
              userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(BPTBalanceBefore, eDAIIndex),
              outputReference,
            }),
            encodeUnwrap(cDAI.address, relayer.address, recipientUser.address, toChainedReference(10 + eDAIIndex)),
          ])
        ).wait();
      });

      it('exits the pool', async () => {
        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
          poolId,
          liquidityProvider: senderUser.address,
        });

        // DAI transfered to recipient
        expectTransferEvent(receipt, { from: cDAI.address, to: relayer.address }, DAIToken);
        expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, DAIToken);
      });

      it('BPT burned from the sender user', async () => {
        const BPTBalanceAfter = await pool.balanceOf(senderUser);
        expect(BPTBalanceAfter).to.be.eq(0);
      });

      it('DAI transfered to recipient user', async () => {
        const DAIBalanceAfter = await DAIToken.balanceOf(recipientUser);
        expect(DAIBalanceAfter).to.be.gt(0);
      });

      it('does not leave dust on the relayer', async () => {
        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await cDAIToken.balanceOf(relayer)).to.be.eq(0);
      });
    });
  });

  function encodeApprove(token: Token | Contract, amount: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('approveVault', [token.address, amount]);
  }

  function encodeWrap(
    wrappedTokenAddress: string,
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapCompoundV2', [
      wrappedTokenAddress,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function encodeUnwrap(
    wrappedTokenAddress: string,
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('unwrapCompoundV2', [
      wrappedTokenAddress,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function encodeJoin(params: {
    poolId: string;
    sender: Account;
    recipient: Account;
    assets: string[];
    maxAmountsIn: BigNumberish[];
    userData: string;
    outputReference?: BigNumberish;
  }): string {
    return relayerLibrary.interface.encodeFunctionData('joinPool', [
      params.poolId,
      0, // WeightedPool
      TypesConverter.toAddress(params.sender),
      TypesConverter.toAddress(params.recipient),
      {
        assets: params.assets,
        maxAmountsIn: params.maxAmountsIn,
        userData: params.userData,
        fromInternalBalance: false,
      },
      0,
      params.outputReference ?? 0,
    ]);
  }

  function encodeExit(params: {
    poolId: string;
    sender: Account;
    recipient: Account;
    assets: string[];
    minAmountsOut: BigNumberish[];
    userData: string;
    outputReference?: { index: number; key: BigNumberish }[];
  }): string {
    return relayerLibrary.interface.encodeFunctionData('exitPool', [
      params.poolId,
      0, //WeightedPool
      TypesConverter.toAddress(params.sender),
      TypesConverter.toAddress(params.recipient),
      {
        assets: params.assets,
        minAmountsOut: params.minAmountsOut,
        userData: params.userData,
        toInternalBalance: false,
      },
      params.outputReference,
    ]);
  }
});
