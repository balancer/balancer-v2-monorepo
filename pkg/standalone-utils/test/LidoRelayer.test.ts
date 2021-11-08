import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';

import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Dictionary } from 'lodash';
import { Interface } from '@ethersproject/abi';

describe('LidoRelayer', function () {
  let stETH: Token, wstETH: Token;
  let basePoolId: string;
  let tokens: TokenList;
  let sender: SignerWithAddress, recipient: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault, basePool: StablePool;
  let relayer: Contract, relayerLibrary: Contract;

  before('setup signer', async () => {
    [, admin, sender, recipient] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    const [deployer] = await ethers.getSigners();
    vault = await Vault.create({ admin });

    const stETHContract = await deploy('MockStETH', { args: [deployer.address, 'stETH', 'stETH', 18] });
    stETH = new Token('stETH', 'stETH', 18, stETHContract);

    const wstETHContract = await deploy('MockWstETH', { args: [stETH.address] });
    wstETH = new Token('wstETH', 'wstETH', 18, wstETHContract);
  });

  sharedBeforeEach('deploy pool', async () => {
    tokens = new TokenList([stETH, wstETH]).sort();

    basePool = await StablePool.create({ tokens, vault });
    basePoolId = basePool.poolId;

    // Seed liquidity in pool
    await stETH.mint(admin, fp(200));
    await stETH.approve(vault.address, MAX_UINT256, { from: admin });

    await stETH.mint(admin, fp(150));
    await stETH.approve(wstETH.address, fp(150), { from: admin });
    await wstETH.instance.connect(admin).wrap(fp(150));
    await wstETH.approve(vault.address, MAX_UINT256, { from: admin });

    await basePool.init({ initialBalances: fp(100), from: admin });
  });

  sharedBeforeEach('mint tokens to sender', async () => {
    await stETH.mint(sender, fp(100));
    await stETH.approve(vault.address, fp(100), { from: sender });

    await stETH.mint(sender, fp(2500));
    await stETH.approve(wstETH.address, fp(150), { from: sender });
    await wstETH.instance.connect(sender).wrap(fp(150));
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
    await authorizer.connect(admin).grantRolesGlobally(relayerActionIds, relayer.address);

    // Approve relayer by sender
    await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
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

  describe('primitives', () => {
    describe('wrapStETH', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = user, recipient = relayer', () => {
        beforeEach(() => {
          tokenSender = sender;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await stETH.transfer(relayer, fp(1), { from: sender });
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      context('sender = relayer, recipient = sender', () => {
        beforeEach(async () => {
          await stETH.transfer(relayer, fp(1), { from: sender });
          tokenSender = relayer;
          tokenRecipient = sender;
        });
        testWrap();
      });

      function testWrap(): void {
        it('wraps with immediate amounts', async () => {
          const amount = fp(1);

          const receipt = await (
            await relayer.connect(sender).multicall([encodeWrap(tokenSender, tokenRecipient, amount)])
          ).wait();

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { to: TypesConverter.toAddress(tokenRecipient) }
          );
        });

        it('stores wrap output as chained reference', async () => {
          const amount = fp(1);

          const receipt = await (
            await relayer
              .connect(sender)
              .multicall([encodeWrap(tokenSender, tokenRecipient, amount, toChainedReference(0))])
          ).wait();

          const {
            args: { value: wstETHAmount },
          } = expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { from: ZERO_ADDRESS, to: TypesConverter.toAddress(relayer) }
          );
          await expectChainedReferenceContents(toChainedReference(0), wstETHAmount);
        });

        it('wraps with chained references', async () => {
          const amount = fp(1);
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer.connect(sender).multicall([encodeWrap(tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { from: relayer.address, to: wstETH.address, value: amount }
          );
        });
      }
    });

    describe('unwrapWstETH', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = user, recipient = relayer', () => {
        beforeEach(async () => {
          await wstETH.approve(vault.address, fp(10), { from: sender });
          tokenSender = sender;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await wstETH.transfer(relayer, fp(1), { from: sender });
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = sender', () => {
        beforeEach(async () => {
          await wstETH.transfer(relayer, fp(1), { from: sender });
          tokenSender = relayer;
          tokenRecipient = sender;
        });
        testUnwrap();
      });

      function testUnwrap(): void {
        it('unwraps with immediate amounts', async () => {
          const amount = fp(1);

          const receipt = await (
            await relayer.connect(sender).multicall([encodeUnwrap(tokenSender, tokenRecipient, amount)])
          ).wait();

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            {
              from:
                TypesConverter.toAddress(tokenRecipient) !== relayer.address
                  ? TypesConverter.toAddress(relayer)
                  : wstETH.address,
              to: TypesConverter.toAddress(tokenRecipient),
              value: await wstETH.instance.getStETHByWstETH(amount),
            },
            stETH.address
          );
        });

        it('stores unwrap output as chained reference', async () => {
          const amount = fp(1);

          await relayer
            .connect(sender)
            .multicall([encodeUnwrap(tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          const stETHAmount = await wstETH.instance.getStETHByWstETH(amount);
          await expectChainedReferenceContents(toChainedReference(0), stETHAmount);
        });

        it('unwraps with chained references', async () => {
          const amount = fp(1);
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer.connect(sender).multicall([encodeUnwrap(tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { from: relayer.address, to: ZERO_ADDRESS, value: amount }
          );
        });
      }
    });

    describe('stakeETH', () => {
      let tokenRecipient: Account;

      context('sender = user, recipient = relayer', () => {
        beforeEach(() => {
          tokenRecipient = relayer;
        });
        testStake();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(() => {
          tokenRecipient = relayer;
        });
        testStake();
      });

      context('sender = relayer, recipient = sender', () => {
        beforeEach(() => {
          tokenRecipient = sender;
        });
        testStake();
      });

      function testStake(): void {
        it('stakes with immediate amounts', async () => {
          const amount = fp(1);

          const receipt = await (
            await relayer.connect(sender).multicall([encodeStakeETH(tokenRecipient, amount)], { value: amount })
          ).wait();

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { to: TypesConverter.toAddress(tokenRecipient) }
          );
        });

        it('stores stake output as chained reference', async () => {
          const amount = fp(1);

          const receipt = await (
            await relayer
              .connect(sender)
              .multicall([encodeStakeETH(tokenRecipient, amount, toChainedReference(0))], { value: amount })
          ).wait();

          const {
            args: { value: wstETHAmount },
          } = expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { from: ZERO_ADDRESS, to: relayer.address }
          );
          await expectChainedReferenceContents(toChainedReference(0), wstETHAmount);
        });

        it('stakes with chained references', async () => {
          const amount = fp(1);
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(sender)
              .multicall([encodeStakeETH(tokenRecipient, toChainedReference(0))], { value: amount })
          ).wait();

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { from: ZERO_ADDRESS, to: relayer.address, value: amount },
            stETH.address
          );
        });
      }
    });

    describe('stakeETHAndWrap', () => {
      let tokenRecipient: Account;

      context('sender = user, recipient = relayer', () => {
        beforeEach(() => {
          tokenRecipient = relayer;
        });
        testStake();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(() => {
          tokenRecipient = relayer;
        });
        testStake();
      });

      context('sender = relayer, recipient = sender', () => {
        beforeEach(() => {
          tokenRecipient = sender;
        });
        testStake();
      });

      function testStake(): void {
        it('unwraps with immediate amounts');
        it('stores unwrap output as chained reference');
        it('unwraps with chained references');
      }
    });
  });

  describe('complex actions', () => {
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
        it('performs the given swap', async () => {
          const poolId = basePoolId;
          const tokenIn = wstETH;
          const tokenOut = stETH;
          const amount = fp(1);

          const receipt = await (
            await relayer.connect(sender).multicall([
              encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(tokenIn, MAX_UINT256),
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn,
                tokenOut,
                amount: toChainedReference(0),
                sender: relayer,
                recipient,
                outputReference: 0,
              }),
            ])
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            // amountIn: singleSwap.amount,
            // amountOut
          });

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { to: recipient.address }
          );
        });

        it('does not leave dust on the relayer', async () => {
          const poolId = basePoolId;
          const tokenIn = wstETH;
          const tokenOut = stETH;
          const amount = fp(1);

          await relayer.connect(sender).multicall([
            encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(tokenIn, MAX_UINT256),
            encodeSwap({
              poolId,
              kind: SwapKind.GivenIn,
              tokenIn,
              tokenOut,
              amount: toChainedReference(0),
              sender: relayer,
              recipient,
              outputReference: 0,
            }),
          ]);

          expect(await stETH.balanceOf(relayer)).to.be.eq(0);
          expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using stETH as an output', () => {
        it('performs the given swap', async () => {
          const poolId = basePoolId;
          const tokenIn = stETH;
          const tokenOut = wstETH;
          const amount = fp(1);

          const receipt = await (
            await relayer.connect(sender).multicall([
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn,
                tokenOut,
                amount,
                sender: sender,
                recipient: relayer,
                outputReference: toChainedReference(0),
              }),
              encodeUnwrap(relayer.address, recipient.address, toChainedReference(0)),
            ])
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            // amountIn: singleSwap.amount,
            // amountOut
          });

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { to: recipient.address }
          );
        });

        it('does not leave dust on the relayer', async () => {
          const poolId = basePoolId;
          const tokenIn = stETH;
          const tokenOut = wstETH;
          const amount = fp(1);

          await relayer.connect(sender).multicall([
            encodeSwap({
              poolId,
              kind: SwapKind.GivenIn,
              tokenIn,
              tokenOut,
              amount,
              sender,
              recipient: relayer,
              outputReference: toChainedReference(0),
            }),
            encodeUnwrap(relayer.address, recipient.address, toChainedReference(0)),
          ]);

          expect(await stETH.balanceOf(relayer)).to.be.eq(0);
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
          index: tokens.findIndexBySymbol(symbol),
          key,
        }));

        return relayerLibrary.interface.encodeFunctionData('batchSwap', [
          SwapKind.GivenIn,
          params.swaps.map((swap) => ({
            poolId: swap.poolId,
            assetInIndex: tokens.indexOf(swap.tokenIn),
            assetOutIndex: tokens.indexOf(swap.tokenOut),
            amount: swap.amount,
            userData: '0x',
          })),
          tokens.addresses,
          {
            sender: TypesConverter.toAddress(params.sender),
            recipient: TypesConverter.toAddress(params.recipient),
            fromInternalBalance: false,
            toInternalBalance: false,
          },
          new Array(tokens.length).fill(MAX_INT256),
          MAX_UINT256,
          0,
          outputReferences,
        ]);
      }

      describe('swap using stETH as an input', () => {
        it('performs the given swap', async () => {
          const poolId = basePoolId;
          const tokenIn = wstETH;
          const tokenOut = stETH;
          const amount = fp(1);

          const receipt = await (
            await relayer.connect(sender).multicall([
              encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
              encodeApprove(tokenIn, MAX_UINT256),
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn, tokenOut, amount: toChainedReference(0) }],
                sender: relayer,
                recipient: recipient,
              }),
            ])
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            // amountIn,
            // amountOut
          });

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { to: recipient.address }
          );
        });

        it('does not leave dust on the relayer', async () => {
          const poolId = basePoolId;
          const tokenIn = wstETH;
          const tokenOut = stETH;
          const amount = fp(1);

          await relayer.connect(sender).multicall([
            encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(tokenIn, MAX_UINT256),
            encodeBatchSwap({
              swaps: [{ poolId, tokenIn, tokenOut, amount: toChainedReference(0) }],
              sender: relayer,
              recipient: recipient,
            }),
          ]);

          expect(await stETH.balanceOf(relayer)).to.be.eq(0);
          expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using stETH as an output', () => {
        it('performs the given swap', async () => {
          const poolId = basePoolId;
          const tokenIn = stETH;
          const tokenOut = wstETH;
          const amount = fp(1);

          const receipt = await (
            await relayer.connect(sender).multicall([
              encodeBatchSwap({
                swaps: [{ poolId, tokenIn, tokenOut, amount }],
                sender: sender,
                recipient: relayer,
                outputReferences: { wstETH: toChainedReference(0) },
              }),
              encodeUnwrap(relayer.address, recipient.address, toChainedReference(0)),
            ])
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolId,
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            // amountIn,
            // amountOut
          });

          expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { to: recipient.address }
          );
        });

        it('does not leave dust on the relayer', async () => {
          const poolId = basePoolId;
          const tokenIn = stETH;
          const tokenOut = wstETH;
          const amount = fp(1);

          await relayer.connect(sender).multicall([
            encodeBatchSwap({
              swaps: [{ poolId, tokenIn, tokenOut, amount }],
              sender: sender,
              recipient: relayer,
              outputReferences: { wstETH: toChainedReference(0) },
            }),
            encodeUnwrap(relayer.address, recipient.address, toChainedReference(0)),
          ]);

          expect(await stETH.balanceOf(relayer)).to.be.eq(0);
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

      context('when the relayer is authorized', () => {
        it('joins the pool', async () => {
          const amount = fp(1);

          const receipt = await relayer.connect(sender).multicall([
            encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(wstETH, MAX_UINT256),
            encodeJoin({
              poolId: basePoolId,
              assets: tokens,
              sender: relayer,
              recipient: recipient,
              maxAmountsIn: tokens.map(() => MAX_UINT256),
              userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                tokens.map((token) => (token === wstETH ? toChainedReference(0) : 0)),
                0
              ),
            }),
          ]);

          expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'PoolBalanceChanged', {
            poolId: basePoolId,
            liquidityProvider: relayer.address,
          });
        });

        it('does not take wstETH from the sender', async () => {
          const amount = fp(1);

          const wstETHBalanceBefore = await wstETH.balanceOf(sender);

          await relayer.connect(sender).multicall([
            encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(wstETH, MAX_UINT256),
            encodeJoin({
              poolId: basePoolId,
              sender: relayer,
              recipient,
              assets: tokens,
              maxAmountsIn: tokens.map(() => MAX_UINT256),
              userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                tokens.map((token) => (token === wstETH ? toChainedReference(0) : 0)),
                0
              ),
            }),
          ]);

          const wstETHBalanceAfter = await wstETH.balanceOf(sender);
          expect(wstETHBalanceAfter).to.be.eq(wstETHBalanceBefore);
        });

        it('does not leave dust on the relayer', async () => {
          const amount = fp(1);

          await relayer.connect(sender).multicall([
            encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(wstETH, MAX_UINT256),
            encodeJoin({
              poolId: basePoolId,
              sender: relayer,
              recipient,
              assets: tokens,
              maxAmountsIn: tokens.map(() => MAX_UINT256),
              userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                tokens.map((token) => (token === wstETH ? toChainedReference(0) : 0)),
                0
              ),
            }),
          ]);

          expect(await stETH.balanceOf(relayer)).to.be.eq(0);
          expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });
  });
});
