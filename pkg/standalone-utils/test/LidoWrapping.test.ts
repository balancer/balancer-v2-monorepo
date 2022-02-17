import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';

import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Dictionary } from 'lodash';

describe('LidoWrapping', function () {
  let stETH: Token, wstETH: Token;
  let senderUser: SignerWithAddress, recipientUser: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;

  before('setup signer', async () => {
    [, admin, senderUser, recipientUser] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });

    const stETHContract = await deploy('MockStETH', { args: ['stETH', 'stETH', 18] });
    stETH = new Token('stETH', 'stETH', 18, stETHContract);

    const wstETHContract = await deploy('MockWstETH', { args: [stETH.address] });
    wstETH = new Token('wstETH', 'wstETH', 18, wstETHContract);
  });

  sharedBeforeEach('mint tokens to senderUser', async () => {
    await stETH.mint(senderUser, fp(100));
    await stETH.approve(vault.address, fp(100), { from: senderUser });

    await stETH.mint(senderUser, fp(2500));
    await stETH.approve(wstETH.address, fp(150), { from: senderUser });
    await wstETH.instance.connect(senderUser).wrap(fp(150));
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Relayer
    relayerLibrary = await deploy('MockBatchRelayerLibrary', { args: [vault.address, wstETH.address] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        actionId(vault.instance, action)
      )
    );
    const authorizer = await deployedAt('v2-vault/Authorizer', await vault.instance.getAuthorizer());
    const wheres = relayerActionIds.map(() => ANY_ADDRESS);
    await authorizer.connect(admin).grantPermissions(relayerActionIds, relayer.address, wheres);

    // Approve relayer by sender
    await vault.instance.connect(senderUser).setRelayerApproval(senderUser.address, relayer.address, true);
  });

  const CHAINED_REFERENCE_PREFIX = 'ba10';
  function toChainedReference(key: BigNumberish): BigNumber {
    // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
    const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

    return BigNumber.from(paddedPrefix).add(key);
  }

  function encodeApprove(token: Token, amount: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('approveVault', [token.address, amount]);
  }

  function encodeWrap(
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapStETH', [
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
    return relayerLibrary.interface.encodeFunctionData('unwrapWstETH', [
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function encodeStakeETH(recipient: Account, amount: BigNumberish, outputReference?: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('stakeETH', [
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function encodeStakeETHAndWrap(recipient: Account, amount: BigNumberish, outputReference?: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('stakeETHAndWrap', [
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  async function setChainedReferenceContents(ref: BigNumberish, value: BigNumberish): Promise<void> {
    await relayer.multicall([relayerLibrary.interface.encodeFunctionData('setChainedReferenceValue', [ref, value])]);
  }

  async function expectChainedReferenceContents(ref: BigNumberish, expectedValue: BigNumberish): Promise<void> {
    const receipt = await (
      await relayer.multicall([relayerLibrary.interface.encodeFunctionData('getChainedReferenceValue', [ref])])
    ).wait();

    expectEvent.inIndirectReceipt(receipt, relayerLibrary.interface, 'ChainedReferenceValueRead', {
      value: bn(expectedValue),
    });
  }

  function expectTransferEvent(
    receipt: ContractReceipt,
    args: { from?: string; to?: string; value?: BigNumberish },
    token: Token
  ) {
    return expectEvent.inIndirectReceipt(receipt, token.instance.interface, 'Transfer', args, token.address);
  }

  describe('primitives', () => {
    const amount = fp(1);

    describe('wrapStETH', () => {
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
          await stETH.transfer(relayer, amount, { from: senderUser });
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      context('sender = relayer, recipient = senderUser', () => {
        beforeEach(async () => {
          await stETH.transfer(relayer, amount, { from: senderUser });
          tokenSender = relayer;
          tokenRecipient = senderUser;
        });
        testWrap();
      });

      function testWrap(): void {
        it('wraps with immediate amounts', async () => {
          const expectedWstETHAmount = await wstETH.instance.getWstETHByStETH(amount);

          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeWrap(tokenSender, tokenRecipient, amount)])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? wstETH : relayer),
              value: amount,
            },
            stETH
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayerIsRecipient ? ZERO_ADDRESS : relayer),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedWstETHAmount,
            },
            wstETH
          );
        });

        it('stores wrap output as chained reference', async () => {
          const expectedWstETHAmount = await wstETH.instance.getWstETHByStETH(amount);

          await relayer
            .connect(senderUser)
            .multicall([encodeWrap(tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          await expectChainedReferenceContents(toChainedReference(0), expectedWstETHAmount);
        });

        it('wraps with chained references', async () => {
          const expectedWstETHAmount = await wstETH.instance.getWstETHByStETH(amount);
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
              to: TypesConverter.toAddress(relayerIsSender ? wstETH : relayer),
              value: amount,
            },
            stETH
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayerIsRecipient ? ZERO_ADDRESS : relayer),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedWstETHAmount,
            },
            wstETH
          );
        });
      }
    });

    describe('unwrapWstETH', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(async () => {
          await wstETH.approve(vault.address, fp(10), { from: senderUser });
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = senderUser, recipient = senderUser', () => {
        beforeEach(async () => {
          await wstETH.approve(vault.address, fp(10), { from: senderUser });
          tokenSender = senderUser;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await wstETH.transfer(relayer, amount, { from: senderUser });
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = senderUser', () => {
        beforeEach(async () => {
          await wstETH.transfer(relayer, amount, { from: senderUser });
          tokenSender = relayer;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      function testUnwrap(): void {
        it('unwraps with immediate amounts', async () => {
          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeUnwrap(tokenSender, tokenRecipient, amount)])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? ZERO_ADDRESS : relayer),
              value: amount,
            },
            wstETH
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayerIsRecipient ? wstETH : relayer),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: await wstETH.instance.getStETHByWstETH(amount),
            },
            stETH
          );
        });

        it('stores unwrap output as chained reference', async () => {
          await relayer
            .connect(senderUser)
            .multicall([encodeUnwrap(tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          const stETHAmount = await wstETH.instance.getStETHByWstETH(amount);
          await expectChainedReferenceContents(toChainedReference(0), stETHAmount);
        });

        it('unwraps with chained references', async () => {
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeUnwrap(tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? ZERO_ADDRESS : relayer),
              value: amount,
            },
            wstETH
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayerIsRecipient ? wstETH : relayer),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: await wstETH.instance.getStETHByWstETH(amount),
            },
            stETH
          );
        });
      }
    });

    describe('stakeETH', () => {
      let tokenRecipient: Account;

      context('recipient = senderUser', () => {
        beforeEach(() => {
          tokenRecipient = senderUser;
        });
        testStake();
      });

      context('recipient = relayer', () => {
        beforeEach(() => {
          tokenRecipient = relayer;
        });
        testStake();
      });

      function testStake(): void {
        it('stakes with immediate amounts', async () => {
          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeStakeETH(tokenRecipient, amount)], { value: amount })
          ).wait();

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: relayerIsRecipient ? ZERO_ADDRESS : relayer.address,
              to: relayerIsRecipient ? relayer.address : TypesConverter.toAddress(tokenRecipient),
              value: amount,
            },
            stETH
          );
        });

        it('returns excess ETH', async () => {
          const excess = fp(1.5);
          const senderBalanceBefore = await ethers.provider.getBalance(senderUser.address);

          const tx = await relayer
            .connect(senderUser)
            .multicall([encodeStakeETH(tokenRecipient, amount)], { value: amount.add(excess) });
          const receipt = await tx.wait();

          expectTransferEvent(receipt, { value: amount }, stETH);

          const txCost = tx.gasPrice.mul(receipt.gasUsed);
          expect(await ethers.provider.getBalance(senderUser.address)).to.equal(
            senderBalanceBefore.sub(txCost).sub(amount)
          );
        });

        it('stores stake output as chained reference', async () => {
          await relayer
            .connect(senderUser)
            .multicall([encodeStakeETH(tokenRecipient, amount, toChainedReference(0))], { value: amount });

          await expectChainedReferenceContents(toChainedReference(0), amount);
        });

        it('stakes with chained references', async () => {
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeStakeETH(tokenRecipient, toChainedReference(0))], { value: amount })
          ).wait();

          expectEvent.inIndirectReceipt(receipt, stETH.instance.interface, 'EthStaked', { amount });

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayerIsRecipient ? ZERO_ADDRESS : relayer),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: amount,
            },
            stETH
          );
        });
      }
    });

    describe('stakeETHAndWrap', () => {
      let tokenRecipient: Account;

      context('recipient = senderUser', () => {
        beforeEach(() => {
          tokenRecipient = senderUser;
        });
        testStakeAndWrap();
      });

      context('recipient = relayer', () => {
        beforeEach(() => {
          tokenRecipient = relayer;
        });
        testStakeAndWrap();
      });

      function testStakeAndWrap(): void {
        it('stakes with immediate amounts', async () => {
          const expectedWstETHAmount = await wstETH.instance.getWstETHByStETH(amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeStakeETHAndWrap(tokenRecipient, amount)], { value: amount })
          ).wait();

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayerIsRecipient ? ZERO_ADDRESS : relayer),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedWstETHAmount,
            },
            wstETH
          );
        });

        it('stores stake output as chained reference', async () => {
          const expectedWstETHAmount = await wstETH.instance.getWstETHByStETH(amount);

          await relayer
            .connect(senderUser)
            .multicall([encodeStakeETHAndWrap(tokenRecipient, amount, toChainedReference(0))], { value: amount });

          await expectChainedReferenceContents(toChainedReference(0), expectedWstETHAmount);
        });

        it('stakes with chained references', async () => {
          const expectedWstETHAmount = await wstETH.instance.getWstETHByStETH(amount);

          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeStakeETHAndWrap(tokenRecipient, toChainedReference(0))], { value: amount })
          ).wait();

          expectEvent.inIndirectReceipt(receipt, stETH.instance.interface, 'EthStaked', { amount });

          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(relayerIsRecipient ? ZERO_ADDRESS : relayer),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedWstETHAmount,
            },
            wstETH
          );
        });
      }
    });
  });

  describe('complex actions', () => {
    let WETH: Token;
    let poolTokens: TokenList;
    let poolId: string;
    let pool: StablePool;

    sharedBeforeEach('deploy pool', async () => {
      WETH = await Token.deployedAt(await vault.instance.WETH());
      poolTokens = new TokenList([WETH, wstETH]).sort();

      pool = await StablePool.create({ tokens: poolTokens, vault });
      poolId = pool.poolId;

      await WETH.mint(senderUser, fp(2));
      await WETH.approve(vault, MAX_UINT256, { from: senderUser });

      // Seed liquidity in pool
      await WETH.mint(admin, fp(200));
      await WETH.approve(vault, MAX_UINT256, { from: admin });

      await stETH.mint(admin, fp(150));
      await stETH.approve(wstETH, fp(150), { from: admin });
      await wstETH.instance.connect(admin).wrap(fp(150));
      await wstETH.approve(vault, MAX_UINT256, { from: admin });

      await pool.init({ initialBalances: fp(100), from: admin });
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

      describe('swap using stETH as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap stETH for WETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(wstETH, MAX_UINT256),
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: wstETH,
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
            tokenIn: wstETH.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using stETH as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap WETH for stETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: WETH,
                tokenOut: wstETH,
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
            tokenOut: wstETH.address,
          });

          expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, stETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
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

      describe('swap using stETH as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap stETH for WETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(wstETH, MAX_UINT256),
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: wstETH, tokenOut: WETH, amount: toChainedReference(0) }],
                sender: relayer,
                recipient: recipientUser,
              }),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: wstETH.address,
            tokenOut: WETH.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using stETH as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap WETH for stETH', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn: WETH, tokenOut: wstETH, amount }],
                sender: senderUser,
                recipient: relayer,
                outputReferences: { wstETH: toChainedReference(0) },
              }),
              encodeUnwrap(relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: WETH.address,
            tokenOut: wstETH.address,
          });

          expectTransferEvent(receipt, { from: relayer.address, to: recipientUser.address }, stETH);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await WETH.balanceOf(relayer)).to.be.eq(0);
          expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

    describe('joinPool', () => {
      function encodeJoin(params: {
        poolId: string;
        sender: Account;
        recipient: Account;
        assets: TokenList;
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
            assets: params.assets.addresses,
            maxAmountsIn: params.maxAmountsIn,
            userData: params.userData,
            fromInternalBalance: false,
          },
          0,
          params.outputReference ?? 0,
        ]);
      }

      let receipt: ContractReceipt;
      let senderWstETHBalanceBefore: BigNumber;
      const amount = fp(1);

      sharedBeforeEach('join the pool', async () => {
        senderWstETHBalanceBefore = await wstETH.balanceOf(senderUser);
        receipt = await (
          await relayer.connect(senderUser).multicall([
            encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(wstETH, MAX_UINT256),
            encodeJoin({
              poolId,
              assets: poolTokens,
              sender: relayer,
              recipient: recipientUser,
              maxAmountsIn: poolTokens.map(() => MAX_UINT256),
              userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                poolTokens.map((token) => (token === wstETH ? toChainedReference(0) : 0)),
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
        expectTransferEvent(
          receipt,
          { from: ZERO_ADDRESS, to: recipientUser.address },
          await Token.deployedAt(pool.address)
        );
      });

      it('does not take wstETH from the user', async () => {
        const senderWstETHBalanceAfter = await wstETH.balanceOf(senderUser);
        expect(senderWstETHBalanceAfter).to.be.eq(senderWstETHBalanceBefore);
      });

      it('does not leave dust on the relayer', async () => {
        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
      });
    });
  });
});
