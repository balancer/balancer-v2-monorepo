import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy, deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { Dictionary } from 'lodash';
import { Interface } from '@ethersproject/abi';

describe('VaultActions', function () {
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let admin: SignerWithAddress, sender: SignerWithAddress;
  let poolIdA: string, poolIdB: string, poolIdC: string;

  before('get signers', async () => {
    [, admin, sender] = await ethers.getSigners();
  });

  const CHAINED_REFERENCE_PREFIX = 'ba10';
  function toChainedReference(key: BigNumberish): BigNumber {
    // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
    const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

    return BigNumber.from(paddedPrefix).add(key);
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

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Balancer Vault
    vault = await Vault.create({ admin });

    // Deploy Relayer
    relayerLibrary = await deploy('MockBatchRelayerLibrary', { args: [vault.address] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        actionId(vault.instance, action)
      )
    );
    const authorizer = await deployedAt('v2-vault/Authorizer', await vault.instance.getAuthorizer());
    await authorizer.connect(admin).grantRoles(relayerActionIds, relayer.address);

    // Approve relayer by sender
    await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  sharedBeforeEach('set up pools', async () => {
    tokens = (await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'])).sort();
    await tokens.mint({ to: sender });
    await tokens.approve({ to: vault, from: sender });

    // Pool A: DAI-MKR
    const poolA = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: new TokenList([tokens.DAI, tokens.MKR]).sort(),
      vault,
    });
    await poolA.init({ initialBalances: fp(1000), from: sender });

    poolIdA = await poolA.getPoolId();

    // Pool B: MKR-SNX
    const poolB = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: new TokenList([tokens.MKR, tokens.SNX]).sort(),
      vault,
    });
    await poolB.init({ initialBalances: fp(1000), from: sender });

    poolIdB = await poolB.getPoolId();

    // Pool C: SNX-BAT
    const poolC = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: new TokenList([tokens.SNX, tokens.BAT]).sort(),
      vault,
    });
    await poolC.init({ initialBalances: fp(1000), from: sender });

    poolIdC = await poolC.getPoolId();
  });

  describe('simple swap', () => {
    const amountIn = fp(2);

    function encodeSwap(params: {
      poolId: string;
      tokenIn: Token;
      tokenOut: Token;
      amount: BigNumberish;
      outputReference?: BigNumberish;
    }): string {
      return relayerLibrary.interface.encodeFunctionData('swap', [
        {
          poolId: params.poolId,
          kind: SwapKind.GivenIn,
          assetIn: params.tokenIn.address,
          assetOut: params.tokenOut.address,
          amount: params.amount,
          userData: '0x',
        },
        { sender: sender.address, recipient: sender.address, fromInternalBalance: false, toInternalBalance: false },
        0,
        MAX_UINT256,
        0,
        params.outputReference ?? 0,
      ]);
    }

    it('swaps with immediate amounts', async () => {
      await expectBalanceChange(
        () =>
          relayer
            .connect(sender)
            .multicall([encodeSwap({ poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountIn })]),
        tokens,
        { account: sender, changes: { DAI: amountIn.mul(-1), MKR: ['near', amountIn] } }
      );
    });

    it('stores swap output as chained reference', async () => {
      const receipt = await (
        await relayer.connect(sender).multicall([
          encodeSwap({
            poolId: poolIdA,
            tokenIn: tokens.DAI,
            tokenOut: tokens.MKR,
            amount: amountIn,
            outputReference: toChainedReference(0),
          }),
        ])
      ).wait();

      const {
        args: { amountOut },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });
      await expectChainedReferenceContents(toChainedReference(0), amountOut);
    });

    it('swaps with chained references', async () => {
      await setChainedReferenceContents(toChainedReference(0), amountIn);

      const receipt = await (
        await relayer.connect(sender).multicall([
          encodeSwap({
            poolId: poolIdA,
            tokenIn: tokens.DAI,
            tokenOut: tokens.MKR,
            amount: toChainedReference(0),
          }),
        ])
      ).wait();

      const swapEvent = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });
      expect(swapEvent.args.amountIn).to.equal(amountIn);
    });

    it('is chainable via multicall', async () => {
      const receipt = await (
        await expectBalanceChange(
          () =>
            relayer.connect(sender).multicall([
              encodeSwap({
                poolId: poolIdA,
                tokenIn: tokens.DAI,
                tokenOut: tokens.MKR,
                amount: amountIn,
                outputReference: toChainedReference(0),
              }),
              encodeSwap({
                poolId: poolIdB,
                tokenIn: tokens.MKR,
                tokenOut: tokens.SNX,
                amount: toChainedReference(0),
              }),
            ]),
          tokens,
          { account: sender, changes: { DAI: amountIn.mul(-1), SNX: ['near', amountIn] } }
        )
      ).wait();

      const {
        args: { amountOut: amountOutA },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });
      const {
        args: { amountIn: amountInB },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdB });

      expect(amountOutA).to.equal(amountInB);
    });
  });

  describe('batch swap', () => {
    const amountInA = fp(2);
    const amountInC = fp(5);

    function encodeBatchSwap(params: {
      swaps: Array<{
        poolId: string;
        tokenIn: Token;
        tokenOut: Token;
        amount: BigNumberish;
      }>;
      outputReferences?: Dictionary<BigNumberish>;
    }): string {
      const outputReferences = new Array(tokens.length).fill(0);
      if (params.outputReferences != undefined) {
        for (const symbol in params.outputReferences) {
          outputReferences[tokens.indexOf(tokens.findBySymbol(symbol))] = params.outputReferences[symbol];
        }
      }

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
        { sender: sender.address, recipient: sender.address, fromInternalBalance: false, toInternalBalance: false },
        new Array(tokens.length).fill(MAX_INT256),
        MAX_UINT256,
        0,
        outputReferences,
      ]);
    }

    it('swaps with immediate amounts', async () => {
      await expectBalanceChange(
        () =>
          relayer.connect(sender).multicall([
            encodeBatchSwap({
              swaps: [
                { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
                { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
              ],
            }),
          ]),
        tokens,
        {
          account: sender,
          changes: {
            DAI: amountInA.mul(-1),
            MKR: ['near', amountInA],
            SNX: amountInC.mul(-1),
            BAT: ['near', amountInC],
          },
        }
      );
    });

    it('stores absolute vault deltas as chained reference', async () => {
      const receipt = await (
        await relayer.connect(sender).multicall([
          encodeBatchSwap({
            swaps: [
              { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
              { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
            ],
            outputReferences: {
              MKR: toChainedReference(0),
              SNX: toChainedReference(1),
            },
          }),
        ])
      ).wait();

      // Note that the ouput references are for MKR (an output) and for SNX (an input)

      const {
        args: { amountOut: amountOutMKR },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });

      const {
        args: { amountIn: amountInSNX },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdC });

      await expectChainedReferenceContents(toChainedReference(0), amountOutMKR);

      await expectChainedReferenceContents(toChainedReference(1), amountInSNX);
    });

    it('swaps with chained references', async () => {
      await setChainedReferenceContents(toChainedReference(0), amountInC);

      const receipt = await (
        await relayer.connect(sender).multicall([
          encodeBatchSwap({
            swaps: [
              { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
              {
                poolId: poolIdC,
                tokenIn: tokens.SNX,
                tokenOut: tokens.BAT,
                amount: toChainedReference(0),
              },
            ],
          }),
        ])
      ).wait();

      const swapEvent = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdC });
      expect(swapEvent.args.amountIn).to.equal(amountInC);
    });

    it('is chainable via multicall', async () => {
      const receipt = await (
        await expectBalanceChange(
          () =>
            relayer.connect(sender).multicall([
              encodeBatchSwap({
                swaps: [
                  { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
                  { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
                ],
                outputReferences: {
                  MKR: toChainedReference(0),
                  BAT: toChainedReference(1),
                },
              }),
              encodeBatchSwap({
                swaps: [
                  // Swap previously acquired MKR for SNX
                  {
                    poolId: poolIdB,
                    tokenIn: tokens.MKR,
                    tokenOut: tokens.SNX,
                    amount: toChainedReference(0),
                  },
                  // Undo first SNX-BAT swap
                  {
                    poolId: poolIdC,
                    tokenIn: tokens.BAT,
                    tokenOut: tokens.SNX,
                    amount: toChainedReference(1),
                  },
                ],
              }),
            ]),
          tokens,
          {
            account: sender,
            changes: {
              DAI: amountInA.mul(-1),
              SNX: ['near', amountInA],
            },
          }
        )
      ).wait();

      const {
        args: { amountOut: amountOutA },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });
      const {
        args: { amountIn: amountInB },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdB });

      expect(amountOutA).to.equal(amountInB);

      const {
        args: { amountOut: amountOutBAT },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
        poolId: poolIdC,
        tokenIn: tokens.SNX.address,
      });
      const {
        args: { amountIn: amountInBAT },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
        poolId: poolIdC,
        tokenIn: tokens.BAT.address,
      });

      expect(amountOutBAT).to.equal(amountInBAT);
    });
  });

  describe('join pool', () => {
    const amountInDAI = fp(2);
    const amountInMKR = fp(5);

    const amountsInA = new Array(2);
    sharedBeforeEach(async () => {
      const { tokens: tokensA } = await vault.getPoolTokens(poolIdA);

      amountsInA[tokensA.indexOf(tokens.DAI.address)] = amountInDAI;
      amountsInA[tokensA.indexOf(tokens.MKR.address)] = amountInMKR;
    });

    async function encodeJoinPool(params: {
      poolId: string;
      userData: string;
      outputReference?: BigNumberish;
    }): Promise<string> {
      const { tokens } = await vault.getPoolTokens(params.poolId);

      return relayerLibrary.interface.encodeFunctionData('joinPool', [
        params.poolId,
        0,
        sender.address,
        sender.address,
        {
          assets: tokens,
          maxAmountsIn: new Array(tokens.length).fill(MAX_UINT256),
          userData: params.userData,
          fromInternalBalance: false,
        },
        0,
        params.outputReference ?? 0,
      ]);
    }

    describe('weighted pool', () => {
      describe('exact tokens in for bpt out', () => {
        it('joins with immediate amounts', async () => {
          await expectBalanceChange(
            async () =>
              relayer.connect(sender).multicall([
                await encodeJoinPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsInA, 0),
                }),
              ]),
            tokens,
            {
              account: sender,
              changes: {
                DAI: amountInDAI.mul(-1),
                MKR: amountInMKR.mul(-1),
              },
            }
          );
        });

        it('stores BPT amount out as chained reference', async () => {
          const receipt = await (
            await relayer.connect(sender).multicall([
              await encodeJoinPool({
                poolId: poolIdA,
                userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsInA, 0),
                outputReference: toChainedReference(0),
              }),
            ])
          ).wait();

          const {
            args: { value: BPTAmountOut },
          } = expectEvent.inIndirectReceipt(
            receipt,
            new Interface((await getArtifact('v2-solidity-utils/ERC20')).abi),
            'Transfer',
            { from: ZERO_ADDRESS, to: sender.address }
          );

          await expectChainedReferenceContents(toChainedReference(0), BPTAmountOut);
        });

        it('joins with exact amounts in chained references', async () => {
          await setChainedReferenceContents(toChainedReference(0), amountInMKR);

          const { tokens: tokensA } = await vault.getPoolTokens(poolIdA);

          const amountsIn = new Array(2);
          amountsIn[tokensA.indexOf(tokens.DAI.address)] = amountInDAI;
          amountsIn[tokensA.indexOf(tokens.MKR.address)] = toChainedReference(0);

          await expectBalanceChange(
            async () =>
              relayer.connect(sender).multicall([
                await encodeJoinPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsIn, 0),
                }),
              ]),
            tokens,
            {
              account: sender,
              changes: {
                DAI: amountInDAI.mul(-1),
                MKR: amountInMKR.mul(-1),
              },
            }
          );
        });
      });
    });
  });
});
