import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { getPoolAddress, SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { Contract } from 'ethers';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { Dictionary } from 'lodash';
import { Zero } from '@ethersproject/constants';
import {
  expectChainedReferenceContents,
  setChainedReferenceContents,
  toChainedReference,
} from './helpers/chainedReferences';

describe('VaultActions', function () {
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let admin: SignerWithAddress, sender: SignerWithAddress;

  let poolIdA: string, poolIdB: string, poolIdC: string;
  let tokensA: TokenList, tokensB: TokenList, tokensC: TokenList;

  before('get signers', async () => {
    [, admin, sender] = await ethers.getSigners();
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Balancer Vault
    vault = await Vault.create({ admin });

    // Deploy Relayer
    relayerLibrary = await deploy('MockBatchRelayerLibrary', { args: [vault.address, ZERO_ADDRESS] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        actionId(vault.instance, action)
      )
    );
    await vault.grantPermissionsGlobally(relayerActionIds, relayer);

    // Approve relayer by sender
    await vault.setRelayerApproval(sender, relayer, true);
  });

  sharedBeforeEach('set up pools', async () => {
    tokens = (await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'])).sort();
    await tokens.mint({ to: sender });
    await tokens.approve({ to: vault, from: sender });

    // Pool A: DAI-MKR
    tokensA = new TokenList([tokens.DAI, tokens.MKR]).sort();
    const poolA = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: tokensA,
      vault,
    });
    await poolA.init({ initialBalances: fp(1000), from: sender });

    poolIdA = await poolA.getPoolId();

    // Pool B: MKR-SNX
    tokensB = new TokenList([tokens.MKR, tokens.SNX]).sort();
    const poolB = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: tokensB,
      vault,
    });
    await poolB.init({ initialBalances: fp(1000), from: sender });

    poolIdB = await poolB.getPoolId();

    // Pool C: SNX-BAT
    tokensC = new TokenList([tokens.SNX, tokens.BAT]).sort();
    const poolC = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: tokensC,
      vault,
    });
    await poolC.init({ initialBalances: fp(1000), from: sender });

    poolIdC = await poolC.getPoolId();
  });

  function encodeSwap(params: {
    poolId: string;
    tokenIn: Token;
    tokenOut: Token;
    amount: BigNumberish;
    fromInternalBalance?: boolean;
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
      {
        sender: sender.address,
        recipient: sender.address,
        fromInternalBalance: params.fromInternalBalance ?? false,
        toInternalBalance: false,
      },
      0,
      MAX_UINT256,
      0,
      params.outputReference ?? 0,
    ]);
  }

  function encodeBatchSwap(params: {
    swaps: Array<{
      poolId: string;
      tokenIn: Token;
      tokenOut: Token;
      amount: BigNumberish;
    }>;
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
      { sender: sender.address, recipient: sender.address, fromInternalBalance: false, toInternalBalance: false },
      new Array(tokens.length).fill(MAX_INT256),
      MAX_UINT256,
      0,
      outputReferences,
    ]);
  }

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

  async function encodeExitPool(params: {
    poolId: string;
    userData: string;
    toInternalBalance: boolean;
    outputReferences?: Dictionary<BigNumberish>;
  }): Promise<string> {
    const { tokens: poolTokens } = await vault.getPoolTokens(params.poolId);
    const outputReferences = Object.entries(params.outputReferences ?? {}).map(([symbol, key]) => ({
      index: poolTokens.findIndex((tokenAddress) => tokenAddress === tokens.findBySymbol(symbol).address),
      key,
    }));

    return relayerLibrary.interface.encodeFunctionData('exitPool', [
      params.poolId,
      0,
      sender.address,
      sender.address,
      {
        assets: poolTokens,
        minAmountsOut: new Array(poolTokens.length).fill(0),
        userData: params.userData,
        toInternalBalance: params.toInternalBalance,
      },
      outputReferences,
    ]);
  }

  function getJoinExitAmounts(poolTokens: TokenList, tokenAmounts: Dictionary<BigNumberish>): Array<BigNumberish> {
    return poolTokens.map((token) => tokenAmounts[token.symbol] ?? 0);
  }

  describe('simple swap', () => {
    const amountIn = fp(2);

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
      await expectChainedReferenceContents(relayer, toChainedReference(0), amountOut);
    });

    it('swaps with chained references', async () => {
      await setChainedReferenceContents(relayer, toChainedReference(0), amountIn);

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

      await expectChainedReferenceContents(relayer, toChainedReference(0), amountOutMKR);

      await expectChainedReferenceContents(relayer, toChainedReference(1), amountInSNX);
    });

    it('swaps with chained references', async () => {
      await setChainedReferenceContents(relayer, toChainedReference(0), amountInC);

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

    describe('weighted pool', () => {
      describe('exact tokens in for bpt out', () => {
        it('joins with immediate amounts', async () => {
          await expectBalanceChange(
            async () =>
              relayer.connect(sender).multicall([
                await encodeJoinPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                    getJoinExitAmounts(tokensA, { DAI: amountInDAI, MKR: amountInMKR }),
                    0
                  ),
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
                userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                  getJoinExitAmounts(tokensA, { DAI: amountInDAI, MKR: amountInMKR }),
                  0
                ),
                outputReference: toChainedReference(0),
              }),
            ])
          ).wait();

          const {
            args: { value: BPTAmountOut },
          } = expectTransferEvent(receipt, { from: ZERO_ADDRESS, to: sender.address }, getPoolAddress(poolIdA));

          await expectChainedReferenceContents(relayer, toChainedReference(0), BPTAmountOut);
        });

        it('joins with exact amounts in chained references', async () => {
          await setChainedReferenceContents(relayer, toChainedReference(0), amountInMKR);

          await expectBalanceChange(
            async () =>
              relayer.connect(sender).multicall([
                await encodeJoinPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                    getJoinExitAmounts(tokensA, { DAI: amountInDAI, MKR: toChainedReference(0) }),
                    0
                  ),
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

        it('is chainable with swaps via multicall', async () => {
          const receipt = await (
            await expectBalanceChange(
              () =>
                relayer.connect(sender).multicall([
                  encodeSwap({
                    poolId: poolIdA,
                    tokenIn: tokens.DAI,
                    tokenOut: tokens.MKR,
                    amount: amountInDAI,
                    outputReference: toChainedReference(0),
                  }),
                  encodeJoinPool({
                    poolId: poolIdB,
                    userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                      getJoinExitAmounts(tokensB, { MKR: toChainedReference(0) }),
                      0
                    ),
                  }),
                ]),
              tokens,
              { account: sender, changes: { DAI: amountInDAI.mul(-1) } }
            )
          ).wait();

          const {
            args: { amountOut: amountOutMKR },
          } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });

          const {
            args: { deltas },
          } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
            poolId: poolIdB,
          });

          expect(deltas[tokensB.indexOf(tokens.MKR)]).to.equal(amountOutMKR);
          expect(deltas[tokensB.indexOf(tokens.SNX)]).to.equal(0);
        });
      });

      describe('token in for exact bpt out', () => {
        it('joins with immediate amounts', async () => {
          const bptOut = fp(2);
          const mkrIndex = tokensA.indexOf(tokens.MKR);

          await expectBalanceChange(
            async () =>
              relayer.connect(sender).multicall([
                await encodeJoinPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.joinTokenInForExactBPTOut(bptOut, mkrIndex),
                }),
              ]),
            tokens,
            {
              account: sender,
              changes: {
                MKR: ['near', bptOut.mul(-1)], // In a balanced pool, BPT should roughly represent the underlying tokens
              },
            }
          );
        });
      });

      describe('all tokens in for exact bpt out', () => {
        it('joins with immediate amounts', async () => {
          const bptOut = fp(2);

          await expectBalanceChange(
            async () =>
              relayer.connect(sender).multicall([
                await encodeJoinPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.joinAllTokensInForExactBPTOut(bptOut),
                }),
              ]),
            tokens,
            {
              account: sender,
              changes: {
                // In a balanced pool, BPT should roughly represent the underlying tokens
                DAI: ['near', bptOut.div(2).mul(-1)],
                MKR: ['near', bptOut.div(2).mul(-1)],
              },
            }
          );
        });
      });
    });
  });

  describe('exit pool', () => {
    const amountInBPT = fp(1);

    async function getBPT(poolId: string): Promise<TokenList> {
      return new TokenList([await Token.deployedAt(getPoolAddress(poolId))]);
    }

    describe('weighted pool', () => {
      function testExitPool(useInternalBalance: boolean): void {
        describe('exact bpt in for tokens', () => {
          it('exits with immediate amounts', async () => {
            await expectBalanceChange(
              async () =>
                relayer.connect(sender).multicall([
                  await encodeExitPool({
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(fp(1)),
                    toInternalBalance: useInternalBalance,
                  }),
                ]),
              await getBPT(poolIdA),
              {
                account: sender,
                changes: {
                  BPT: amountInBPT.mul(-1),
                },
              }
            );
          });

          it('stores token amount out as chained reference', async () => {
            const receipt = await (
              await relayer.connect(sender).multicall([
                await encodeExitPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amountInBPT),
                  toInternalBalance: useInternalBalance,
                  outputReferences: {
                    DAI: toChainedReference(0),
                    MKR: toChainedReference(1),
                  },
                }),
              ])
            ).wait();

            let daiAmountOut = Zero;
            let mkrAmountOut = Zero;
            if (useInternalBalance) {
              const daiTransfer = expectEvent.inIndirectReceipt(
                receipt,
                vault.instance.interface,
                'InternalBalanceChanged',
                {
                  user: sender.address,
                  token: tokens.DAI.address,
                }
              );
              const mkrTransfer = expectEvent.inIndirectReceipt(
                receipt,
                vault.instance.interface,
                'InternalBalanceChanged',
                {
                  user: sender.address,
                  token: tokens.MKR.address,
                }
              );

              daiAmountOut = daiTransfer.args.delta;
              mkrAmountOut = mkrTransfer.args.delta;
            } else {
              const daiTransfer = expectTransferEvent(receipt, { from: vault.address, to: sender.address }, tokens.DAI);
              const mkrTransfer = expectTransferEvent(receipt, { from: vault.address, to: sender.address }, tokens.MKR);

              daiAmountOut = daiTransfer.args.value;
              mkrAmountOut = mkrTransfer.args.value;
            }

            await expectChainedReferenceContents(relayer, toChainedReference(0), daiAmountOut);
            await expectChainedReferenceContents(relayer, toChainedReference(1), mkrAmountOut);
          });

          it('exits with exact bpt in chained reference', async () => {
            await setChainedReferenceContents(relayer, toChainedReference(0), amountInBPT);

            await expectBalanceChange(
              async () =>
                relayer.connect(sender).multicall([
                  await encodeExitPool({
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(toChainedReference(0)),
                    toInternalBalance: useInternalBalance,
                  }),
                ]),
              await getBPT(poolIdA),
              {
                account: sender,
                changes: {
                  BPT: amountInBPT.mul(-1),
                },
              }
            );
          });

          it('is chainable with swaps via multicall', async () => {
            const receipt = await (
              await expectBalanceChange(
                async () =>
                  relayer.connect(sender).multicall([
                    await encodeExitPool({
                      poolId: poolIdA,
                      userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amountInBPT),
                      toInternalBalance: useInternalBalance,
                      outputReferences: {
                        MKR: toChainedReference(0),
                      },
                    }),
                    encodeSwap({
                      poolId: poolIdA,
                      tokenIn: tokens.MKR,
                      tokenOut: tokens.DAI,
                      fromInternalBalance: useInternalBalance,
                      amount: toChainedReference(0),
                    }),
                  ]),
                await getBPT(poolIdA),
                {
                  account: sender,
                  changes: {
                    BPT: amountInBPT.mul(-1),
                  },
                }
              )
            ).wait();

            const {
              args: { deltas },
            } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
              poolId: poolIdA,
            });

            const {
              args: { amountIn: amountInMKR },
            } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });

            expect(deltas[tokensA.indexOf(tokens.MKR)].mul(-1)).to.equal(amountInMKR);
          });
        });

        describe('exact bpt in for one token', () => {
          it('exits with immediate amounts', async () => {
            await expectBalanceChange(
              async () =>
                relayer.connect(sender).multicall([
                  await encodeExitPool({
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(fp(1), 0),
                    toInternalBalance: useInternalBalance,
                  }),
                ]),
              await getBPT(poolIdA),
              {
                account: sender,
                changes: {
                  BPT: amountInBPT.mul(-1),
                },
              }
            );
          });

          it('stores token amount out as chained reference', async () => {
            const receipt = await (
              await relayer.connect(sender).multicall([
                await encodeExitPool({
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(
                    amountInBPT,
                    tokensA.findIndexBySymbol('MKR')
                  ),
                  toInternalBalance: useInternalBalance,
                  outputReferences: {
                    MKR: toChainedReference(0),
                  },
                }),
              ])
            ).wait();

            let mkrAmountOut = Zero;
            if (useInternalBalance) {
              const mkrTransfer = expectEvent.inIndirectReceipt(
                receipt,
                vault.instance.interface,
                'InternalBalanceChanged',
                {
                  user: sender.address,
                  token: tokens.MKR.address,
                }
              );

              mkrAmountOut = mkrTransfer.args.delta;
            } else {
              const mkrTransfer = expectTransferEvent(receipt, { from: vault.address, to: sender.address }, tokens.MKR);

              mkrAmountOut = mkrTransfer.args.value;
            }

            await expectChainedReferenceContents(relayer, toChainedReference(0), mkrAmountOut);
          });

          it('exits with exact bpt in chained reference', async () => {
            await setChainedReferenceContents(relayer, toChainedReference(0), amountInBPT);

            await expectBalanceChange(
              async () =>
                relayer.connect(sender).multicall([
                  await encodeExitPool({
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(
                      toChainedReference(0),
                      tokensA.findIndexBySymbol('MKR')
                    ),
                    toInternalBalance: useInternalBalance,
                  }),
                ]),
              await getBPT(poolIdA),
              {
                account: sender,
                changes: {
                  BPT: amountInBPT.mul(-1),
                },
              }
            );
          });

          it('is chainable with swaps via multicall', async () => {
            const receipt = await (
              await expectBalanceChange(
                async () =>
                  relayer.connect(sender).multicall([
                    await encodeExitPool({
                      poolId: poolIdA,
                      userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(
                        amountInBPT,
                        tokensA.findIndexBySymbol('MKR')
                      ),
                      toInternalBalance: useInternalBalance,
                      outputReferences: {
                        MKR: toChainedReference(0),
                      },
                    }),
                    encodeSwap({
                      poolId: poolIdA,
                      tokenIn: tokens.MKR,
                      tokenOut: tokens.DAI,
                      amount: toChainedReference(0),
                      fromInternalBalance: useInternalBalance,
                    }),
                  ]),
                await getBPT(poolIdA),
                {
                  account: sender,
                  changes: {
                    BPT: amountInBPT.mul(-1),
                  },
                }
              )
            ).wait();

            const {
              args: { deltas },
            } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
              poolId: poolIdA,
            });

            const {
              args: { amountIn: amountInMKR },
            } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });

            expect(deltas[tokensA.indexOf(tokens.MKR)].mul(-1)).to.equal(amountInMKR);
          });
        });

        describe('bpt in for exact tokens out', () => {
          const amountOutMKR = fp(1);
          const amountOutDAI = fp(2);

          it('exits with immediate amounts', async () => {
            await expectBalanceChange(
              async () =>
                relayer.connect(sender).multicall([
                  await encodeExitPool({
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.exitBPTInForExactTokensOut([amountOutMKR, amountOutDAI], MAX_UINT256),
                    toInternalBalance: useInternalBalance,
                  }),
                ]),
              await getBPT(poolIdA),
              {
                account: sender,
                changes: {
                  BPT: ['lt', 0],
                  MKR: amountOutMKR,
                  DAI: amountOutDAI,
                },
              }
            );
          });
        });
      }

      describe('exit to external balance', () => {
        const toInternalBalance = false;
        testExitPool(toInternalBalance);
      });

      describe('exit to internal balance', () => {
        const toInternalBalance = true;
        testExitPool(toInternalBalance);
      });
    });
  });
});
