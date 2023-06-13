import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { StablePoolEncoder, SwapKind } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Dictionary } from 'lodash';
import { expectChainedReferenceContents, toChainedReference } from './helpers/chainedReferences';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('SiloWrapping', function () {
  let DAI: Token, sDAI: Token, mockSilo: Contract;
  let senderUser: SignerWithAddress, recipientUser: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;

  before('setup signer', async () => {
    [, admin, senderUser, recipientUser] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });
    // Set up and deploy tokens
    DAI = await deploy('v2-solidity-utils/TestToken', {
      args: ['DAI', 'DAI', 18],
    });

    mockSilo = await deploy('MockSilo', {
      args: [DAI.address],
    });

    sDAI = await deploy('MockShareToken', {
      args: ['sDAI', 'sDAI', 18, mockSilo.address, DAI.address],
    });

    // initalize the asset storage mapping within the Silo for the main token
    await mockSilo.setAssetStorage(
      DAI.address, // interestBearingAsset
      sDAI.address, // CollateralToken
      sDAI.address, // CollateralOnlyToken (using wrapped token as a placeholder)
      sDAI.address, // debtToken (using wrapped token as a placeholder)
      fp(20000), // totalDeposits; These values do not matter for the sack of relayer tests
      fp(100), // collateralOnlyDeposits; These values do not matter for the sack of relayer tests
      fp(9000) // totalBorrowAmount; These values do not matter for the sack of relayer tests
    );
  });

  sharedBeforeEach('mint tokens to senderUser', async () => {
    await DAI.mint(senderUser.address, fp(100));
    await sDAI.mint(senderUser.address, fp(100));

    await DAI.connect(senderUser).approve(vault.address, fp(100));
    await sDAI.connect(senderUser).approve(vault.address, fp(100));
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
    const authorizer = vault.authorizer;
    await Promise.all(
      relayerActionIds.map((action) => {
        return authorizer.connect(admin).grantPermission(action, relayer.address, ANY_ADDRESS);
      })
    );

    // Approve relayer by sender
    await vault.instance.connect(senderUser).setRelayerApproval(senderUser.address, relayer.address, true);
  });

  function encodeApprove(token: Token, amount: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('approveVault', [token.address, amount]);
  }

  function encodeWrap(
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapShareToken', [
      sDAI.address,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function encodeUnwrap(
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('unwrapShareToken', [
      sDAI.address,
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
      0, // WeightedPool
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

  async function setChainedReferenceContents(ref: BigNumberish, value: BigNumberish): Promise<void> {
    await relayer.multicall([relayerLibrary.interface.encodeFunctionData('setChainedReferenceValue', [ref, value])]);
  }

  describe('primitives', () => {
    const amount = fp(1);

    describe('wrap DAI', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(async () => {
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
          const expectedsDAIAmount = await mockSilo.underlyingToShares(amount);

          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeWrap(tokenSender, tokenRecipient, amount)])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? mockSilo : relayer),
              value: amount,
            },
            DAI
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(ZERO_ADDRESS),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedsDAIAmount,
            },
            sDAI
          );
        });

        it('stores wrap output as chained reference', async () => {
          const expectedsDAIAmount = await mockSilo.underlyingToShares(amount);

          await relayer
            .connect(senderUser)
            .multicall([encodeWrap(tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          await expectChainedReferenceContents(relayer, toChainedReference(0), expectedsDAIAmount);
        });

        it('wraps with chained references', async () => {
          const expectedsDAIAmount = await mockSilo.underlyingToShares(amount);
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeWrap(tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? mockSilo : relayer),
              value: amount,
            },
            DAI
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(ZERO_ADDRESS),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedsDAIAmount,
            },
            sDAI
          );
        });
      }
    });

    describe('unwrap sDAI', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(async () => {
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = senderUser, recipient = senderUser', () => {
        beforeEach(async () => {
          tokenSender = senderUser;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await sDAI.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = senderUser', () => {
        beforeEach(async () => {
          await sDAI.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      function testUnwrap(): void {
        beforeEach('Load the liquidity pool with underlying tokens', async () => {
          const expectedDAIAmount = await mockSilo.sharesToUnderlying(amount);
          await DAI.connect(senderUser).mint(mockSilo.address, expectedDAIAmount);
        });

        it('unwraps with immediate amounts', async () => {
          const expectedDAIAmount = await mockSilo.sharesToUnderlying(amount);

          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeUnwrap(tokenSender, tokenRecipient, amount)])
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
              sDAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: ZERO_ADDRESS,
              value: amount,
            },
            sDAI
          );

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(mockSilo),
              to: TypesConverter.toAddress(relayer),
              value: expectedDAIAmount,
            },
            DAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: expectedDAIAmount,
              },
              DAI
            );
          }
        });

        it('stores unwrap output as chained reference', async () => {
          const expectedDAIAmount = await mockSilo.sharesToUnderlying(amount);

          await relayer
            .connect(senderUser)
            .multicall([encodeUnwrap(tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          await expectChainedReferenceContents(relayer, toChainedReference(0), expectedDAIAmount);
        });

        it('unwraps with chained references', async () => {
          const expectedDAIAmount = await mockSilo.sharesToUnderlying(amount);
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeUnwrap(tokenSender, tokenRecipient, toChainedReference(0))])
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
              sDAI
            );
          }
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayer),
              to: ZERO_ADDRESS,
              value: amount,
            },
            sDAI
          );

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(mockSilo),
              to: TypesConverter.toAddress(relayer),
              value: expectedDAIAmount,
            },
            DAI
          );
          if (!relayerIsRecipient) {
            expectTransferEvent(
              receipt,
              {
                from: TypesConverter.toAddress(relayer),
                to: TypesConverter.toAddress(tokenRecipient),
                value: expectedDAIAmount,
              },
              DAI
            );
          }
        });
      }
    });
  });

  describe('complex actions', () => {
    let WETH: Token, DAIToken: Token, sDAIToken: Token;
    let poolTokens: TokenList;
    let poolId: string;
    let pool: StablePool;
    let bptIndex: number;

    sharedBeforeEach('deploy pool', async () => {
      WETH = await Token.deployedAt(await vault.instance.WETH());
      DAIToken = await Token.deployedAt(await DAI.address);
      sDAIToken = await Token.deployedAt(await sDAI.address);
      poolTokens = new TokenList([WETH, sDAIToken]).sort();

      pool = await StablePool.create({ tokens: poolTokens, vault });
      poolId = pool.poolId;

      await WETH.mint(senderUser, fp(2));
      await WETH.approve(vault, MAX_UINT256, { from: senderUser });

      // Seed liquidity in pool
      await WETH.mint(admin, fp(200));
      await WETH.approve(vault, MAX_UINT256, { from: admin });

      await DAIToken.mint(admin, fp(150));
      await DAIToken.approve(sDAI, fp(150), { from: admin });
      // await sDAIToken.connect(admin).wrap(fp(150));
      await sDAIToken.approve(vault, MAX_UINT256, { from: admin });

      bptIndex = await pool.getBptIndex();
      const initialBalances = Array.from({ length: 3 }).map((_, i) => (i == bptIndex ? 0 : fp(100)));

      await pool.init({ initialBalances, from: admin });
    });

    describe('swap', () => {
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

      describe('swap using DAI as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap DAI for WETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(sDAI, MAX_UINT256),
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: sDAI,
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
            tokenIn: sDAI.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await sDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using DAI as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap WETH for DAI', async () => {
          // Add DAI into the Silo to simulate an already existing liquidity pool
          const expectedDAIAmount = await mockSilo.sharesToUnderlying(amount);
          await DAI.connect(senderUser).mint(mockSilo.address, expectedDAIAmount);

          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: WETH,
                tokenOut: sDAIToken,
                amount,
                sender: senderUser,
                recipient: relayer,
                outputReference: toChainedReference(0),
              }),
              encodeUnwrap(relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: WETH.address,
            tokenOut: sDAIToken.address,
          });

          expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, DAI);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await sDAIToken.balanceOf(relayer)).to.be.eq(0);
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
              encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(sDAIToken, MAX_UINT256),
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: sDAIToken, tokenOut: WETH, amount: toChainedReference(0) }],
                sender: relayer,
                recipient: recipientUser,
              }),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: sDAI.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await sDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using DAI as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap WETH for DAI', async () => {
          // Add DAI into the Silo to simulate an already existing liquidity pool
          const expectedDAIAmount = await mockSilo.sharesToUnderlying(amount);
          await DAI.connect(senderUser).mint(mockSilo.address, expectedDAIAmount);

          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: WETH, tokenOut: sDAIToken, amount }],
                sender: senderUser,
                recipient: relayer,
                outputReferences: { sDAI: toChainedReference(0) },
              }),
              encodeUnwrap(relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: WETH.address,
            tokenOut: sDAI.address,
          });

          expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, DAI);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await sDAIToken.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

    describe('joinPool', () => {
      let receipt: ContractReceipt;
      let sendersDAIBalanceBefore: BigNumber;
      const amount = fp(1);

      sharedBeforeEach('join the pool', async () => {
        const { tokens: allTokens } = await pool.getTokens();

        sendersDAIBalanceBefore = await sDAIToken.balanceOf(senderUser);
        receipt = await (
          await relayer.connect(senderUser).multicall([
            encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(sDAIToken, MAX_UINT256),
            encodeJoin({
              poolId,
              assets: allTokens,
              sender: relayer,
              recipient: recipientUser,
              maxAmountsIn: Array(poolTokens.length + 1).fill(MAX_UINT256),
              userData: StablePoolEncoder.joinExactTokensInForBPTOut(
                poolTokens.map((token) => (token === sDAIToken ? toChainedReference(0) : 0)),
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

      it('does not take sDAI from the user', async () => {
        const sendersDAIBalanceAfter = await sDAIToken.balanceOf(senderUser);
        expect(sendersDAIBalanceAfter).to.be.eq(sendersDAIBalanceBefore);
      });

      it('does not leave dust on the relayer', async () => {
        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await sDAIToken.balanceOf(relayer)).to.be.eq(0);
      });
    });

    describe('exitPool', () => {
      let receipt: ContractReceipt;
      let BPTBalanceBefore: BigNumber;
      const amountDAI = fp(1);

      sharedBeforeEach('exit the pool', async () => {
        const { tokens: allTokens } = await pool.getTokens();

        // First transfer tokens to pool, before testing exit
        await relayer.connect(senderUser).multicall([
          encodeWrap(senderUser.address, relayer.address, amountDAI, toChainedReference(0)),
          encodeApprove(sDAIToken, MAX_UINT256),
          encodeJoin({
            poolId,
            assets: allTokens,
            sender: relayer,
            recipient: senderUser,
            maxAmountsIn: Array(poolTokens.length + 1).fill(MAX_UINT256),
            userData: StablePoolEncoder.joinExactTokensInForBPTOut(
              poolTokens.map((token) => (token === sDAIToken ? toChainedReference(0) : 0)),
              0
            ),
          }),
        ]);

        const sDAIIndexWithoutBPT = poolTokens.tokens.findIndex(
          (token: Token) => token.instance.address === sDAIToken.address
        );
        const sDAIIndex = allTokens.findIndex((tokenAddress: string) => tokenAddress === sDAIToken.address);
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
              userData: StablePoolEncoder.exitExactBPTInForOneTokenOut(BPTBalanceBefore, sDAIIndexWithoutBPT),
              outputReference,
            }),
            encodeUnwrap(relayer.address, recipientUser.address, toChainedReference(10 + sDAIIndex)),
          ])
        ).wait();
      });

      it('exits the pool', async () => {
        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
          poolId,
          liquidityProvider: senderUser.address,
        });

        // DAI transfered to recipient
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
        expect(await sDAIToken.balanceOf(relayer)).to.be.eq(0);
      });
    });
  });
});
