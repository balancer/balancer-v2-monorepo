import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { getPoolAddress, SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_INT256, MAX_UINT256, randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
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
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import {
  setupRelayerEnvironment,
  encodeJoinPool,
  encodeExitPool,
  encodeSwap,
  getJoinExitAmounts,
  approveVaultForRelayer,
  PoolKind,
} from './VaultActionsRelayer.setup';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('VaultActions', function () {
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let user: SignerWithAddress, other: SignerWithAddress;

  let poolIdA: string, poolIdB: string, poolIdC: string;
  let tokensA: TokenList, tokensB: TokenList, tokensC: TokenList;

  let recipient: Account;

  before('setup environment', async () => {
    ({ user, other, vault, relayer, relayerLibrary } = await setupRelayerEnvironment());
  });

  before('setup common recipient', () => {
    // All the tests use the same recipient; this is a simple abstraction to improve readability.
    recipient = randomAddress();
  });

  sharedBeforeEach('set up pools', async () => {
    tokens = (await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'])).sort();
    await tokens.mint({ to: user });
    await tokens.approve({ to: vault, from: user });

    // Pool A: DAI-MKR
    tokensA = new TokenList([tokens.DAI, tokens.MKR]).sort();
    const poolA = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: tokensA,
      vault,
    });
    await poolA.init({ initialBalances: fp(1000), from: user });

    poolIdA = await poolA.getPoolId();

    // Pool B: MKR-SNX
    tokensB = new TokenList([tokens.MKR, tokens.SNX]).sort();
    const poolB = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: tokensB,
      vault,
    });
    await poolB.init({ initialBalances: fp(1000), from: user });

    poolIdB = await poolB.getPoolId();

    // Pool C: SNX-BAT
    tokensC = new TokenList([tokens.SNX, tokens.BAT]).sort();
    const poolC = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: tokensC,
      vault,
    });
    await poolC.init({ initialBalances: fp(1000), from: user });

    poolIdC = await poolC.getPoolId();
  });

  function encodeBatchSwap(params: {
    swaps: Array<{
      poolId: string;
      tokenIn: Token;
      tokenOut: Token;
      amount: BigNumberish;
    }>;
    outputReferences?: Dictionary<BigNumberish>;
    sender: Account;
    recipient?: Account;
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
        recipient: params.recipient ?? TypesConverter.toAddress(recipient),
        fromInternalBalance: false,
        toInternalBalance: false,
      },
      new Array(tokens.length).fill(MAX_INT256),
      MAX_UINT256,
      0,
      outputReferences,
    ]);
  }

  describe('simple swap', () => {
    const amountIn = fp(2);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        expect(
          relayer.connect(other).multicall([
            encodeSwap(relayerLibrary, {
              poolId: poolIdA,
              tokenIn: tokens.DAI,
              tokenOut: tokens.MKR,
              amount: amountIn,
              sender: user.address,
              recipient,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      context('sender = user', () => {
        beforeEach(() => {
          sender = user;
        });

        itTestsSimpleSwap();
      });

      context('sender = relayer', () => {
        sharedBeforeEach('fund relayer with tokens and approve vault', async () => {
          sender = relayer;
          await tokens.DAI.transfer(relayer, amountIn, { from: user });
          await approveVaultForRelayer(relayerLibrary, user, tokens);
        });

        itTestsSimpleSwap();
      });

      function itTestsSimpleSwap() {
        it('swaps with immediate amounts', async () => {
          await expectBalanceChange(
            () =>
              relayer.connect(user).multicall([
                encodeSwap(relayerLibrary, {
                  poolId: poolIdA,
                  tokenIn: tokens.DAI,
                  tokenOut: tokens.MKR,
                  amount: amountIn,
                  sender,
                  recipient,
                }),
              ]),
            tokens,
            sender == recipient // if sender is recipient, all the changes happen in the same account.
              ? {
                  account: TypesConverter.toAddress(sender),
                  changes: { DAI: amountIn.mul(-1), MKR: ['near', amountIn] },
                }
              : [
                  {
                    account: TypesConverter.toAddress(sender),
                    changes: { DAI: amountIn.mul(-1) },
                  },
                  {
                    account: TypesConverter.toAddress(recipient),
                    changes: { MKR: ['near', amountIn] },
                  },
                ]
          );
        });

        it('stores swap output as chained reference', async () => {
          const receipt = await (
            await relayer.connect(user).multicall([
              encodeSwap(relayerLibrary, {
                poolId: poolIdA,
                tokenIn: tokens.DAI,
                tokenOut: tokens.MKR,
                amount: amountIn,
                outputReference: toChainedReference(0),
                sender,
                recipient,
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
            await relayer.connect(user).multicall([
              encodeSwap(relayerLibrary, {
                poolId: poolIdA,
                tokenIn: tokens.DAI,
                tokenOut: tokens.MKR,
                amount: toChainedReference(0),
                sender,
                recipient,
              }),
            ])
          ).wait();

          const swapEvent = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolIdA,
          });
          expect(swapEvent.args.amountIn).to.equal(amountIn);
        });

        it('is chainable via multicall', async () => {
          const receipt = await (
            await expectBalanceChange(
              () =>
                relayer.connect(user).multicall([
                  encodeSwap(relayerLibrary, {
                    poolId: poolIdA,
                    tokenIn: tokens.DAI,
                    tokenOut: tokens.MKR,
                    amount: amountIn,
                    outputReference: toChainedReference(0),
                    sender,
                    recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next swap.
                  }),
                  encodeSwap(relayerLibrary, {
                    poolId: poolIdB,
                    tokenIn: tokens.MKR,
                    tokenOut: tokens.SNX,
                    amount: toChainedReference(0),
                    sender,
                    recipient,
                  }),
                ]),
              tokens,
              sender == recipient // if sender is recipient, all the changes happen in the same account.
                ? {
                    account: TypesConverter.toAddress(sender),
                    changes: { DAI: amountIn.mul(-1), SNX: ['near', amountIn] },
                  }
                : [
                    { account: TypesConverter.toAddress(sender), changes: { DAI: amountIn.mul(-1) } },
                    { account: TypesConverter.toAddress(recipient), changes: { SNX: ['near', amountIn] } },
                  ]
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
      }
    });
  });

  describe('batch swap', () => {
    const amountInA = fp(2);
    const amountInC = fp(5);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([encodeBatchSwap({ swaps: [], sender: user.address })])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      context('sender = user', () => {
        beforeEach(() => {
          sender = user;
        });

        itTestsBatchSwap();
      });

      context('sender = relayer', () => {
        sharedBeforeEach('fund relayer with tokens and approve vault', async () => {
          sender = relayer;
          await tokens.DAI.transfer(relayer, amountInA, { from: user });
          await tokens.SNX.transfer(relayer, amountInC, { from: user });
          await approveVaultForRelayer(relayerLibrary, user, tokens);
        });

        itTestsBatchSwap();
      });

      function itTestsBatchSwap() {
        it('swaps with immediate amounts', async () => {
          await expectBalanceChange(
            () =>
              relayer.connect(user).multicall([
                encodeBatchSwap({
                  swaps: [
                    { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
                    { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
                  ],
                  sender,
                }),
              ]),
            tokens,
            sender == recipient
              ? {
                  account: TypesConverter.toAddress(sender),
                  changes: {
                    DAI: amountInA.mul(-1),
                    MKR: ['near', amountInA],
                    SNX: amountInC.mul(-1),
                    BAT: ['near', amountInC],
                  },
                }
              : [
                  {
                    account: TypesConverter.toAddress(sender),
                    changes: {
                      DAI: amountInA.mul(-1),
                      SNX: amountInC.mul(-1),
                    },
                  },
                  {
                    account: TypesConverter.toAddress(recipient),
                    changes: {
                      MKR: ['near', amountInA],
                      BAT: ['near', amountInC],
                    },
                  },
                ]
          );
        });

        it('stores absolute vault deltas as chained reference', async () => {
          const receipt = await (
            await relayer.connect(user).multicall([
              encodeBatchSwap({
                swaps: [
                  { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
                  { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
                ],
                sender,
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
            await relayer.connect(user).multicall([
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
                sender,
              }),
            ])
          ).wait();

          const swapEvent = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId: poolIdC,
          });
          expect(swapEvent.args.amountIn).to.equal(amountInC);
        });

        it('is chainable via multicall', async () => {
          const receipt = await (
            await expectBalanceChange(
              () =>
                relayer.connect(user).multicall([
                  encodeBatchSwap({
                    swaps: [
                      { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
                      { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
                    ],
                    outputReferences: {
                      MKR: toChainedReference(0),
                      BAT: toChainedReference(1),
                    },
                    sender,
                    recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next swap.
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
                    sender,
                  }),
                ]),
              tokens,
              sender == recipient
                ? // if sender is recipient, all the changes happen in the same account.
                  {
                    account: TypesConverter.toAddress(sender),
                    changes: {
                      DAI: amountInA.mul(-1),
                      SNX: ['near', amountInA],
                    },
                  }
                : [
                    // if recipient is not sender, the two swaps add up and the recipient ends up with more tokens.
                    {
                      account: TypesConverter.toAddress(sender),
                      changes: {
                        DAI: amountInA.mul(-1),
                        SNX: ['near', amountInC.mul(-1)],
                      },
                    },
                    {
                      account: TypesConverter.toAddress(recipient),
                      changes: {
                        SNX: ['near', amountInA.add(amountInC)],
                      },
                    },
                  ]
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
      }
    });
  });

  describe('join pool', () => {
    const amountInDAI = fp(2);
    const amountInMKR = fp(5);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([
            await encodeJoinPool(vault, relayerLibrary, {
              poolKind: PoolKind.WEIGHTED,
              poolId: poolIdA,
              userData: '0x',
              sender: user.address,
              recipient: recipient,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      describe('weighted pool', () => {
        context('sender = user', () => {
          beforeEach(() => {
            sender = user;
          });

          itTestsJoin();
        });

        context('sender = relayer', () => {
          sharedBeforeEach('fund relayer with tokens and approve vault', async () => {
            sender = relayer;
            await tokens.DAI.transfer(relayer, amountInDAI, { from: user });
            await tokens.MKR.transfer(relayer, amountInMKR, { from: user });
            await approveVaultForRelayer(relayerLibrary, user, tokens);
          });

          itTestsJoin();
        });
      });

      function itTestsJoin() {
        describe('exact tokens in for bpt out', () => {
          it('joins with immediate amounts', async () => {
            await expectBalanceChange(
              async () =>
                relayer.connect(user).multicall([
                  await encodeJoinPool(vault, relayerLibrary, {
                    poolKind: PoolKind.WEIGHTED,
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                      getJoinExitAmounts(tokensA, { DAI: amountInDAI, MKR: amountInMKR }),
                      0
                    ),
                    sender,
                    recipient,
                  }),
                ]),
              tokens,
              {
                account: TypesConverter.toAddress(sender),
                changes: {
                  DAI: amountInDAI.mul(-1),
                  MKR: amountInMKR.mul(-1),
                },
              }
            );
          });

          it('stores BPT amount out as chained reference', async () => {
            const receipt = await (
              await relayer.connect(user).multicall([
                await encodeJoinPool(vault, relayerLibrary, {
                  poolKind: PoolKind.WEIGHTED,
                  poolId: poolIdA,
                  userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                    getJoinExitAmounts(tokensA, { DAI: amountInDAI, MKR: amountInMKR }),
                    0
                  ),
                  sender,
                  recipient,
                  outputReference: toChainedReference(0),
                }),
              ])
            ).wait();

            const {
              args: { value: BPTAmountOut },
            } = expectTransferEvent(
              receipt,
              { from: ZERO_ADDRESS, to: TypesConverter.toAddress(recipient) },
              getPoolAddress(poolIdA)
            );

            await expectChainedReferenceContents(relayer, toChainedReference(0), BPTAmountOut);
          });

          it('joins with exact amounts in chained references', async () => {
            await setChainedReferenceContents(relayer, toChainedReference(0), amountInMKR);

            await expectBalanceChange(
              async () =>
                relayer.connect(user).multicall([
                  await encodeJoinPool(vault, relayerLibrary, {
                    poolKind: PoolKind.WEIGHTED,
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                      getJoinExitAmounts(tokensA, { DAI: amountInDAI, MKR: toChainedReference(0) }),
                      0
                    ),
                    sender,
                    recipient,
                  }),
                ]),
              tokens,
              {
                account: TypesConverter.toAddress(sender),
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
                  relayer.connect(user).multicall([
                    encodeSwap(relayerLibrary, {
                      poolId: poolIdA,
                      tokenIn: tokens.DAI,
                      tokenOut: tokens.MKR,
                      amount: amountInDAI,
                      outputReference: toChainedReference(0),
                      sender,
                      recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next join.
                    }),
                    encodeJoinPool(vault, relayerLibrary, {
                      poolKind: PoolKind.WEIGHTED,
                      poolId: poolIdB,
                      userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
                        getJoinExitAmounts(tokensB, { MKR: toChainedReference(0) }),
                        0
                      ),
                      sender,
                      recipient,
                    }),
                  ]),
                tokens,
                { account: TypesConverter.toAddress(sender), changes: { DAI: amountInDAI.mul(-1) } }
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
                relayer.connect(user).multicall([
                  await encodeJoinPool(vault, relayerLibrary, {
                    poolKind: PoolKind.WEIGHTED,
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.joinTokenInForExactBPTOut(bptOut, mkrIndex),
                    sender,
                    recipient,
                  }),
                ]),
              tokens,
              {
                account: TypesConverter.toAddress(sender),
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
                relayer.connect(user).multicall([
                  await encodeJoinPool(vault, relayerLibrary, {
                    poolKind: PoolKind.WEIGHTED,
                    poolId: poolIdA,
                    userData: WeightedPoolEncoder.joinAllTokensInForExactBPTOut(bptOut),
                    sender,
                    recipient,
                  }),
                ]),
              tokens,
              {
                account: TypesConverter.toAddress(sender),
                changes: {
                  // In a balanced pool, BPT should roughly represent the underlying tokens
                  DAI: ['near', bptOut.div(2).mul(-1)],
                  MKR: ['near', bptOut.div(2).mul(-1)],
                },
              }
            );
          });
        });
      }
    });
  });

  describe('exit pool', () => {
    const amountInBPT = fp(1);

    async function getBPT(poolId: string): Promise<TokenList> {
      return new TokenList([await Token.deployedAt(getPoolAddress(poolId))]);
    }

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([
            await encodeExitPool(vault, relayerLibrary, tokens, {
              poolKind: PoolKind.WEIGHTED,
              poolId: poolIdA,
              userData: '0x',
              toInternalBalance: true,
              sender: user.address,
              recipient,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      describe('weighted pool', () => {
        context('sender = user', () => {
          beforeEach(() => {
            sender = user;
          });

          itTestsExit();
        });

        context('sender = relayer', () => {
          sharedBeforeEach('fund relayer with BPT and approve vault', async () => {
            sender = relayer;
            const BPT = (await getBPT(poolIdA)).get(0).instance;
            BPT.connect(user).transfer(TypesConverter.toAddress(sender), await BPT.balanceOf(user.address));

            await approveVaultForRelayer(relayerLibrary, user, tokens);
          });

          itTestsExit();
        });

        function itTestsExit() {
          describe('exit to external balance', () => {
            const toInternalBalance = false;
            testExitPool(toInternalBalance);
          });

          describe('exit to internal balance', () => {
            const toInternalBalance = true;
            testExitPool(toInternalBalance);
          });

          function testExitPool(useInternalBalance: boolean): void {
            describe('exact bpt in for tokens', () => {
              it('exits with immediate amounts', async () => {
                await expectBalanceChange(
                  async () =>
                    relayer.connect(user).multicall([
                      await encodeExitPool(vault, relayerLibrary, tokens, {
                        poolKind: PoolKind.WEIGHTED,
                        poolId: poolIdA,
                        userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(fp(1)),
                        toInternalBalance: useInternalBalance,
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdA),
                  {
                    account: TypesConverter.toAddress(sender),
                    changes: {
                      BPT: amountInBPT.mul(-1),
                    },
                  }
                );
              });

              it('stores token amount out as chained reference', async () => {
                const receipt = await (
                  await relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.WEIGHTED,
                      poolId: poolIdA,
                      userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amountInBPT),
                      toInternalBalance: useInternalBalance,
                      outputReferences: {
                        DAI: toChainedReference(0),
                        MKR: toChainedReference(1),
                      },
                      sender,
                      recipient,
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
                      user: TypesConverter.toAddress(recipient),
                      token: tokens.DAI.address,
                    }
                  );
                  const mkrTransfer = expectEvent.inIndirectReceipt(
                    receipt,
                    vault.instance.interface,
                    'InternalBalanceChanged',
                    {
                      user: TypesConverter.toAddress(recipient),
                      token: tokens.MKR.address,
                    }
                  );

                  daiAmountOut = daiTransfer.args.delta;
                  mkrAmountOut = mkrTransfer.args.delta;
                } else {
                  const daiTransfer = expectTransferEvent(
                    receipt,
                    { from: vault.address, to: TypesConverter.toAddress(recipient) },
                    tokens.DAI
                  );
                  const mkrTransfer = expectTransferEvent(
                    receipt,
                    { from: vault.address, to: TypesConverter.toAddress(recipient) },
                    tokens.MKR
                  );

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
                    relayer.connect(user).multicall([
                      await encodeExitPool(vault, relayerLibrary, tokens, {
                        poolKind: PoolKind.WEIGHTED,
                        poolId: poolIdA,
                        userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(toChainedReference(0)),
                        toInternalBalance: useInternalBalance,
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdA),
                  {
                    account: TypesConverter.toAddress(sender),
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
                      relayer.connect(user).multicall([
                        await encodeExitPool(vault, relayerLibrary, tokens, {
                          poolKind: PoolKind.WEIGHTED,
                          poolId: poolIdA,
                          userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amountInBPT),
                          toInternalBalance: useInternalBalance,
                          outputReferences: {
                            MKR: toChainedReference(0),
                          },
                          sender,
                          recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next swap.
                        }),
                        encodeSwap(relayerLibrary, {
                          poolId: poolIdA,
                          tokenIn: tokens.MKR,
                          tokenOut: tokens.DAI,
                          fromInternalBalance: useInternalBalance,
                          amount: toChainedReference(0),
                          sender,
                          recipient,
                        }),
                      ]),
                    await getBPT(poolIdA),
                    {
                      account: TypesConverter.toAddress(sender),
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
                    relayer.connect(user).multicall([
                      await encodeExitPool(vault, relayerLibrary, tokens, {
                        poolKind: PoolKind.WEIGHTED,
                        poolId: poolIdA,
                        userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(fp(1), 0),
                        toInternalBalance: useInternalBalance,
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdA),
                  {
                    account: TypesConverter.toAddress(sender),
                    changes: {
                      BPT: amountInBPT.mul(-1),
                    },
                  }
                );
              });

              it('stores token amount out as chained reference', async () => {
                const receipt = await (
                  await relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.WEIGHTED,
                      poolId: poolIdA,
                      userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(
                        amountInBPT,
                        tokensA.findIndexBySymbol('MKR')
                      ),
                      toInternalBalance: useInternalBalance,
                      outputReferences: {
                        MKR: toChainedReference(0),
                      },
                      sender,
                      recipient,
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
                      user: TypesConverter.toAddress(recipient),
                      token: tokens.MKR.address,
                    }
                  );

                  mkrAmountOut = mkrTransfer.args.delta;
                } else {
                  const mkrTransfer = expectTransferEvent(
                    receipt,
                    { from: vault.address, to: TypesConverter.toAddress(recipient) },
                    tokens.MKR
                  );

                  mkrAmountOut = mkrTransfer.args.value;
                }

                await expectChainedReferenceContents(relayer, toChainedReference(0), mkrAmountOut);
              });

              it('exits with exact bpt in chained reference', async () => {
                await setChainedReferenceContents(relayer, toChainedReference(0), amountInBPT);

                await expectBalanceChange(
                  async () =>
                    relayer.connect(user).multicall([
                      await encodeExitPool(vault, relayerLibrary, tokens, {
                        poolKind: PoolKind.WEIGHTED,
                        poolId: poolIdA,
                        userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(
                          toChainedReference(0),
                          tokensA.findIndexBySymbol('MKR')
                        ),
                        toInternalBalance: useInternalBalance,
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdA),
                  {
                    account: TypesConverter.toAddress(sender),
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
                      relayer.connect(user).multicall([
                        await encodeExitPool(vault, relayerLibrary, tokens, {
                          poolKind: PoolKind.WEIGHTED,
                          poolId: poolIdA,
                          userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(
                            amountInBPT,
                            tokensA.findIndexBySymbol('MKR')
                          ),
                          toInternalBalance: useInternalBalance,
                          outputReferences: {
                            MKR: toChainedReference(0),
                          },
                          sender,
                          recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next swap.
                        }),
                        encodeSwap(relayerLibrary, {
                          poolId: poolIdA,
                          tokenIn: tokens.MKR,
                          tokenOut: tokens.DAI,
                          amount: toChainedReference(0),
                          fromInternalBalance: useInternalBalance,
                          sender,
                          recipient,
                        }),
                      ]),
                    await getBPT(poolIdA),
                    {
                      account: TypesConverter.toAddress(sender),
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
                    relayer.connect(user).multicall([
                      await encodeExitPool(vault, relayerLibrary, tokens, {
                        poolKind: PoolKind.WEIGHTED,
                        poolId: poolIdA,
                        userData: WeightedPoolEncoder.exitBPTInForExactTokensOut(
                          [amountOutMKR, amountOutDAI],
                          MAX_UINT256
                        ),
                        toInternalBalance: useInternalBalance,
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdA),
                  {
                    account: TypesConverter.toAddress(sender),
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
        }
      });
    });
  });
});
