import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';

import { SwapKind, StablePoolEncoder } from '@balancer-labs/balancer-js';
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

describe('EulerWrapping', function () {
  let DAI: Contract, eDAI: Contract;
  let mockEulerProtocol: Contract;
  let senderUser: SignerWithAddress, recipientUser: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;

  before('setup signers', async () => {
    [, admin, senderUser, recipientUser] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });

    mockEulerProtocol = await deploy('MockEulerProtocol');

    DAI = await deploy('v2-solidity-utils/TestToken', { args: ['DAI', 'DAI', 18] });

    const daiAddress = DAI.address;
    const eulerProtocolAddress = mockEulerProtocol.address;

    eDAI = await deploy('MockEulerToken', {
      args: ['eDAI', 'eDAI', 18, daiAddress, eulerProtocolAddress],
    });
    await eDAI.setExchangeRateMultiplier(bn(5e18));
  });

  sharedBeforeEach('mint tokens to senderUser', async () => {
    await DAI.mint(senderUser.address, fp(100));
    await DAI.connect(senderUser).approve(vault.address, fp(100));

    await eDAI.mint(senderUser.address, fp(100));
    await eDAI.connect(senderUser).approve(vault.address, fp(100));
  });

  sharedBeforeEach('set up relayer', async () => {
    // deploy Relayer
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

  describe('primitives', async () => {
    const amount = fp(100);

    describe('wrap Euler', async () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = senderUser, recipient = relayer', () => {
        this.beforeEach(() => {
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      function testWrap(): void {
        it('wraps with immediate amounts', async () => {
          const expectedulerAmount = await eDAI.convertUnderlyingToBalance(amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeWrap(eDAI.address, mockEulerProtocol.address, tokenSender, tokenRecipient, amount)])
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
              to: TypesConverter.toAddress(mockEulerProtocol),
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
              value: expectedulerAmount,
            },
            eDAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: expectedulerAmount,
              },
              eDAI
            );
          }
        });
      }
    });

    describe('unwrap Euler', async () => {
      let tokenSender: Account, tokenRecipient: Account;

      beforeEach(async () => {
        // Euler protocol does not have any underlying tokens
        // so we wint them.
        DAI.mint(mockEulerProtocol.address, fp(5000));
      });

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(async () => {
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      function testUnwrap(): void {
        it('unwraps with immediate amounts', async () => {
          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeUnwrap(eDAI.address, tokenSender, tokenRecipient, amount)])
          ).wait();

          const unwrappedAmount = await eDAI.convertBalanceToUnderlying(amount);

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          if (!relayerIsSender) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(tokenSender),
                to: TypesConverter.toAddress(relayer),
                value: amount,
              },
              eDAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(mockEulerProtocol),
              to: TypesConverter.toAddress(relayer),
              value: unwrappedAmount,
            },
            DAI
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: ZERO_ADDRESS,
              value: amount,
            },
            eDAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: unwrappedAmount,
              },
              DAI
            );
          }
        });
        it('stores unwrap output as chained reference', async () => {
          await relayer
            .connect(senderUser)
            .multicall([encodeUnwrap(eDAI.address, tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          const mainAmount = await eDAI.convertBalanceToUnderlying(amount);
          await expectChainedReferenceContents(relayer, toChainedReference(0), mainAmount);
        });

        it('unwraps with chained references', async () => {
          await setChainedReferenceContents(relayer, toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeUnwrap(eDAI.address, tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          const unwrappedAmount = await eDAI.convertBalanceToUnderlying(amount);

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          if (!relayerIsSender) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(tokenSender),
                to: TypesConverter.toAddress(relayer),
                value: amount,
              },
              eDAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(mockEulerProtocol),
              to: TypesConverter.toAddress(relayer),
              value: unwrappedAmount,
            },
            DAI
          );

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: ZERO_ADDRESS,
              value: amount,
            },
            eDAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: unwrappedAmount,
              },
              DAI
            );
          }
        });
      }
    });
  });

  describe('complex actions', () => {
    let WETH: Token, DAIToken: Token, eDAIToken: Token;
    let poolTokens: TokenList;
    let poolId: string;
    let pool: StablePool;
    let bptIndex: number;

    sharedBeforeEach('deploy pool', async () => {
      WETH = await Token.deployedAt(await vault.instance.WETH());
      DAIToken = await Token.deployedAt(await DAI.address);
      eDAIToken = await Token.deployedAt(await eDAI.address);
      poolTokens = new TokenList([WETH, eDAIToken]).sort();

      pool = await StablePool.create({ tokens: poolTokens, vault });
      poolId = pool.poolId;

      await WETH.mint(senderUser, fp(2));
      await WETH.approve(vault, MAX_UINT256, { from: senderUser });

      // Seed liquidity in pool
      await WETH.mint(admin, fp(200));
      await WETH.approve(vault, MAX_UINT256, { from: admin });

      await DAIToken.mint(admin, fp(150));
      await DAIToken.mint(mockEulerProtocol, fp(5000));
      await DAIToken.approve(eDAI, fp(150), { from: admin });
      await eDAIToken.approve(vault, MAX_UINT256, { from: admin });

      bptIndex = await pool.getBptIndex();
      const initialBalances = Array.from({ length: 3 }).map((_, i) => (i == bptIndex ? 0 : fp(100)));

      await pool.init({ initialBalances, from: admin });
    });

    describe('swap', () => {
      describe('swap using DAI as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap DAI for WETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeWrap(
                eDAI.address,
                mockEulerProtocol.address,
                senderUser.address,
                relayer.address,
                amount,
                toChainedReference(0)
              ),
              encodeApprove(eDAI, MAX_UINT256),
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: eDAI,
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
            tokenIn: eDAI.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await eDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using DAI as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap WETH for DAI', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: WETH,
                tokenOut: eDAIToken,
                amount,
                sender: senderUser,
                recipient: relayer,
                outputReference: toChainedReference(0),
              }),
              encodeUnwrap(eDAI.address, relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: WETH.address,
            tokenOut: eDAIToken.address,
          });

          expectTransferEvent(receipt, { from: mockEulerProtocol.address, to: relayer.address }, DAI);
          if (recipientUser.address !== relayer.address) {
            expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, DAI);
          }
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await eDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

    describe('batchswap', () => {
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
              encodeWrap(
                eDAI.address,
                mockEulerProtocol.address,
                senderUser.address,
                relayer.address,
                amount,
                toChainedReference(0)
              ),
              encodeApprove(eDAIToken, MAX_UINT256),
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: eDAIToken, tokenOut: WETH, amount: toChainedReference(0) }],
                sender: relayer,
                recipient: recipientUser,
              }),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: eDAI.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await eDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using DAI as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap WETH for DAI', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: WETH, tokenOut: eDAIToken, amount }],
                sender: senderUser,
                recipient: relayer,
                outputReferences: { eDAI: toChainedReference(0) },
              }),
              encodeUnwrap(eDAI.address, relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: WETH.address,
            tokenOut: eDAI.address,
          });

          expectTransferEvent(receipt, { from: mockEulerProtocol.address, to: relayer.address }, DAI);
          if (recipientUser.address !== relayer.address) {
            expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, DAI);
          }
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await eDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

    describe('joinPool', () => {
      let receipt: ContractReceipt;
      let sendereDAIBalanceBefore: BigNumber;
      const amount = fp(1);

      sharedBeforeEach('join the pool', async () => {
        const { tokens: allTokens } = await pool.getTokens();

        sendereDAIBalanceBefore = await eDAIToken.balanceOf(senderUser);
        receipt = await (
          await relayer.connect(senderUser).multicall([
            encodeWrap(
              eDAI.address,
              mockEulerProtocol.address,
              senderUser.address,
              relayer.address,
              amount,
              toChainedReference(0)
            ),
            encodeApprove(eDAIToken, MAX_UINT256),
            encodeJoin({
              poolId,
              assets: allTokens,
              sender: relayer,
              recipient: recipientUser,
              maxAmountsIn: Array(poolTokens.length + 1).fill(MAX_UINT256),
              userData: StablePoolEncoder.joinExactTokensInForBPTOut(
                poolTokens.map((token) => (token === eDAIToken ? toChainedReference(0) : 0)),
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

      it('does not take eDAI from the user', async () => {
        const sendereDAIBalanceAfter = await eDAIToken.balanceOf(senderUser);
        expect(sendereDAIBalanceAfter).to.be.eq(sendereDAIBalanceBefore);
      });

      it('does not leave dust on the relayer', async () => {
        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await eDAIToken.balanceOf(relayer)).to.be.eq(0);
      });
    });

    describe('exitPool', () => {
      let receipt: ContractReceipt;
      let BPTBalanceBefore: BigNumber;
      const amountDAI = fp(1);

      sharedBeforeEach('exit the pool', async () => {
        const { tokens: allTokens } = await pool.getTokens();

        // First transfer token to the pool, before testing exit
        await relayer.connect(senderUser).multicall([
          encodeWrap(
            eDAI.address,
            mockEulerProtocol.address,
            senderUser.address,
            relayer.address,
            amountDAI,
            toChainedReference(0)
          ),
          encodeApprove(eDAIToken, MAX_UINT256),
          encodeJoin({
            poolId,
            assets: allTokens,
            sender: relayer,
            recipient: senderUser,
            maxAmountsIn: Array(poolTokens.length + 1).fill(MAX_UINT256),
            userData: StablePoolEncoder.joinExactTokensInForBPTOut(
              poolTokens.map((token) => (token === eDAIToken ? toChainedReference(0) : 0)),
              0
            ),
          }),
        ]);

        const eDAIIndexWithoutBPT = poolTokens.tokens.findIndex(
          (token: Token) => token.instance.address === eDAIToken.address
        );
        const eDAIIndex = allTokens.findIndex((tokenAddress: string) => tokenAddress === eDAIToken.address);
        const outputReference = allTokens.map((_, i) => ({ index: i, key: toChainedReference(10 + i) }));
        BPTBalanceBefore = await pool.balanceOf(senderUser);

        receipt = await (
          await relayer.connect(senderUser).multicall([
            encodeApprove(pool, MAX_UINT256),
            encodeExit({
              poolId,
              assets: allTokens,
              sender: senderUser,
              recipient: relayer,
              minAmountsOut: Array(poolTokens.length + 1).fill(0),
              userData: StablePoolEncoder.exitExactBPTInForOneTokenOut(BPTBalanceBefore, eDAIIndexWithoutBPT),
              outputReference,
            }),
            encodeUnwrap(eDAI.address, relayer.address, recipientUser.address, toChainedReference(10 + eDAIIndex)),
          ])
        ).wait();
      });

      it('exits the pool', async () => {
        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
          poolId,
          liquidityProvider: senderUser.address,
        });

        // DAI transfered to recipient
        expectTransferEvent(receipt, { from: mockEulerProtocol.address, to: relayer.address }, DAIToken);
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
        expect(await eDAIToken.balanceOf(relayer)).to.be.eq(0);
      });
    });
  });

  function encodeApprove(token: Token, amount: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('approveVault', [token.address, amount]);
  }

  function encodeWrap(
    wrappedTokenAddress: string,
    eulerProtocol: Account,
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapEuler', [
      wrappedTokenAddress,
      eulerProtocol,
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
    return relayerLibrary.interface.encodeFunctionData('unwrapEuler', [
      wrappedTokenAddress,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function encodeSwap(params: {
    poolId: string;
    kind: SwapKind;
    tokenIn: Token;
    tokenOut: Token;
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
