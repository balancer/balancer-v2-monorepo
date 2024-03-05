import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { BasePoolEncoder, getPoolAddress, UserBalanceOpKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_UINT256, randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { Contract } from 'ethers';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
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
  encodeBatchSwap,
  getJoinExitAmounts,
  approveVaultForRelayer,
  PoolKind,
  OutputReference,
} from './VaultActionsRelayer.setup';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('VaultActions', function () {
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let user: SignerWithAddress, other: SignerWithAddress;
  let poolA: WeightedPool;
  let admin: SignerWithAddress;

  let poolIdA: string, poolIdB: string, poolIdC: string;
  let tokensA: TokenList, tokensB: TokenList, tokensC: TokenList;

  let recipient: Account;

  before('setup environment', async () => {
    ({ user, admin, other, vault, relayer, relayerLibrary } = await setupRelayerEnvironment());
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
    poolA = await WeightedPool.create({
      tokens: tokensA,
      vault,
    });
    await poolA.init({ initialBalances: fp(1000), from: user });

    poolIdA = await poolA.getPoolId();

    // Pool B: MKR-SNX
    tokensB = new TokenList([tokens.MKR, tokens.SNX]).sort();
    const poolB = await WeightedPool.create({
      tokens: tokensB,
      vault,
    });
    await poolB.init({ initialBalances: fp(1000), from: user });

    poolIdB = await poolB.getPoolId();

    // Pool C: SNX-BAT
    tokensC = new TokenList([tokens.SNX, tokens.BAT]).sort();
    const poolC = await WeightedPool.create({
      tokens: tokensC,
      vault,
    });
    await poolC.init({ initialBalances: fp(1000), from: user });

    poolIdC = await poolC.getPoolId();
  });

  function encodeManageUserBalance(params: {
    ops: Array<{
      kind: UserBalanceOpKind;
      asset: string;
      amount: BigNumberish;
      sender: Account;
      recipient?: Account;
    }>;
    outputReferences?: OutputReference[];
  }): string {
    return relayerLibrary.interface.encodeFunctionData('manageUserBalance', [
      params.ops.map((op) => ({
        kind: op.kind,
        asset: op.asset,
        amount: op.amount,
        sender: TypesConverter.toAddress(op.sender),
        recipient: op.recipient ?? TypesConverter.toAddress(recipient),
      })),
      0,
      params.outputReferences ?? [],
    ]);
  }

  async function getBPT(poolId: string): Promise<TokenList> {
    return new TokenList([await Token.deployedAt(getPoolAddress(poolId))]);
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
          relayer
            .connect(other)
            .multicall([encodeBatchSwap({ relayerLibrary, tokens, swaps: [], sender: user.address, recipient })])
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
                  relayerLibrary,
                  tokens,
                  swaps: [
                    { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
                    { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
                  ],
                  sender,
                  recipient,
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
                relayerLibrary,
                tokens,
                swaps: [
                  { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountInA },
                  { poolId: poolIdC, tokenIn: tokens.SNX, tokenOut: tokens.BAT, amount: amountInC },
                ],
                sender,
                recipient,
                outputReferences: {
                  MKR: toChainedReference(0),
                  SNX: toChainedReference(1),
                },
              }),
            ])
          ).wait();

          // Note that the output references are for MKR (an output) and for SNX (an input)

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
                relayerLibrary,
                tokens,
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
                recipient,
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
                    relayerLibrary,
                    tokens,
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
                    relayerLibrary,
                    tokens,
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
                    recipient,
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
          const events = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {}, vault.address, 4);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect(events.map((e: any) => e.signature)).to.deep.equal(
            Array(4).fill('Swap(bytes32,address,address,uint256,uint256)')
          );
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

  describe('exit pool in recovery mode', () => {
    const amountInBPT = fp(1);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([
            await encodeExitPool(vault, relayerLibrary, tokens, {
              // We need to give it a pool kind, but it doesn't matter which one. The logic checks for the special
              // exit kind first, and only checks the pool kind when it is NOT a recovery exit.
              poolKind: PoolKind.LEGACY_STABLE,
              poolId: poolIdA,
              userData: BasePoolEncoder.recoveryModeExit(amountInBPT),
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

      sharedBeforeEach('enter recovery mode', async () => {
        await poolA.enableRecoveryMode(admin);

        expect(await poolA.inRecoveryMode()).to.be.true;
      });

      describe('weighted pool', () => {
        context('sender = user', () => {
          beforeEach(() => {
            sender = user;
          });

          itTestsRecoveryModeExit();
        });

        context('sender = relayer', () => {
          sharedBeforeEach('fund relayer with BPT and approve vault', async () => {
            sender = relayer;
            const BPT = (await getBPT(poolIdA)).get(0).instance;
            BPT.connect(user).transfer(TypesConverter.toAddress(sender), await BPT.balanceOf(user.address));

            await approveVaultForRelayer(relayerLibrary, user, tokens);
          });

          itTestsRecoveryModeExit();
        });

        function itTestsRecoveryModeExit() {
          describe('exit to external balance', () => {
            const toInternalBalance = false;
            testRecoveryModeExitPool(toInternalBalance);
          });

          describe('exit to internal balance', () => {
            const toInternalBalance = true;
            testRecoveryModeExitPool(toInternalBalance);
          });

          function testRecoveryModeExitPool(useInternalBalance: boolean): void {
            describe('exact bpt in for all tokens', () => {
              it('exits with immediate amounts', async () => {
                await expectBalanceChange(
                  async () =>
                    relayer.connect(user).multicall([
                      await encodeExitPool(vault, relayerLibrary, tokens, {
                        poolKind: PoolKind.WEIGHTED,
                        poolId: poolIdA,
                        userData: BasePoolEncoder.recoveryModeExit(fp(1)),
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
                      userData: BasePoolEncoder.recoveryModeExit(amountInBPT),
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
                        userData: BasePoolEncoder.recoveryModeExit(toChainedReference(0)),
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
                          userData: BasePoolEncoder.recoveryModeExit(amountInBPT),
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
          }
        }
      });
    });
  });

  describe('user balance ops', () => {
    const amountDAI = fp(2);
    const amountSNX = fp(5);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([
            encodeManageUserBalance({
              ops: [
                {
                  kind: UserBalanceOpKind.DepositInternal,
                  asset: tokens.DAI.address,
                  amount: amountDAI,
                  sender: user.address,
                },
              ],
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

        itTestsUserBalance();
      });

      context('sender = relayer', () => {
        sharedBeforeEach('fund relayer with tokens and approve vault', async () => {
          sender = relayer;
          await tokens.DAI.transfer(relayer, amountDAI, { from: user });
          await tokens.SNX.transfer(relayer, amountSNX, { from: user });
          await approveVaultForRelayer(relayerLibrary, user, tokens);
        });

        itTestsUserBalance();
      });

      function itTestsUserBalance() {
        it('sends immediate amounts', async () => {
          // Internal balance of sender doesn't change
          // Tokens are transferred from sender to recipient's internal balance
          // Note that `expectBalanceChange` can check *either* the accounts' external or internal balances: not both.
          // In this case, we are checking the *internal* balances, so we need to pass the vault contract optional
          // parameter to make it do this.

          await expectBalanceChange(
            () =>
              relayer.connect(user).multicall([
                encodeManageUserBalance({
                  ops: [
                    { kind: UserBalanceOpKind.DepositInternal, asset: tokens.DAI.address, amount: amountDAI, sender },
                    { kind: UserBalanceOpKind.DepositInternal, asset: tokens.SNX.address, amount: amountSNX, sender },
                  ],
                }),
              ]),
            tokens,
            [
              {
                account: TypesConverter.toAddress(sender),
                changes: {
                  DAI: 0,
                  SNX: 0,
                },
              },
              {
                account: TypesConverter.toAddress(recipient),
                changes: {
                  DAI: amountDAI,
                  SNX: amountSNX,
                },
              },
            ],
            vault.instance // passing this argument tells it to compare *internal* balances
          );
        });

        it('stores vault deltas as chained references', async () => {
          await (
            await relayer.connect(user).multicall([
              encodeManageUserBalance({
                ops: [
                  { kind: UserBalanceOpKind.DepositInternal, asset: tokens.DAI.address, amount: amountDAI, sender },
                  { kind: UserBalanceOpKind.DepositInternal, asset: tokens.SNX.address, amount: amountSNX, sender },
                ],
                outputReferences: [
                  { index: 0, key: toChainedReference(0) },
                  { index: 1, key: toChainedReference(1) },
                ],
              }),
            ])
          ).wait();

          await expectChainedReferenceContents(relayer, toChainedReference(0), amountDAI);

          await expectChainedReferenceContents(relayer, toChainedReference(1), amountSNX);
        });

        it('emits internal balance events', async () => {
          const receipt = await (
            await relayer.connect(user).multicall([
              encodeManageUserBalance({
                ops: [
                  { kind: UserBalanceOpKind.DepositInternal, asset: tokens.DAI.address, amount: amountDAI, sender },
                  { kind: UserBalanceOpKind.DepositInternal, asset: tokens.SNX.address, amount: amountSNX, sender },
                ],
                outputReferences: [
                  { index: 0, key: toChainedReference(0) },
                  { index: 1, key: toChainedReference(1) },
                ],
              }),
            ])
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(recipient),
            token: tokens.DAI.address,
            delta: amountDAI,
          });

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(recipient),
            token: tokens.SNX.address,
            delta: amountSNX,
          });
        });

        it('uses chained references', async () => {
          await setChainedReferenceContents(relayer, toChainedReference(0), amountDAI);

          const receipt = await (
            await relayer.connect(user).multicall([
              encodeManageUserBalance({
                ops: [
                  {
                    kind: UserBalanceOpKind.DepositInternal,
                    asset: tokens.DAI.address,
                    amount: toChainedReference(0),
                    sender,
                  },
                ],
              }),
            ])
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(recipient),
            token: tokens.DAI.address,
            delta: amountDAI,
          });
        });

        it('is chainable via multicall', async () => {
          // `expectBalanceChange` can check *either* internal or external balances, depending on the presence or
          // absence of the vault parameter. Here we are checking *internal* balances.

          const receipt = await (
            await expectBalanceChange(
              () =>
                relayer.connect(user).multicall([
                  encodeManageUserBalance({
                    ops: [
                      {
                        kind: UserBalanceOpKind.DepositInternal,
                        asset: tokens.DAI.address,
                        amount: amountDAI,
                        sender,
                        recipient: relayer.address,
                      },
                      {
                        kind: UserBalanceOpKind.DepositInternal,
                        asset: tokens.SNX.address,
                        amount: amountSNX,
                        sender,
                        recipient: relayer.address,
                      },
                    ],
                    outputReferences: [
                      { index: 0, key: toChainedReference(0) },
                      { index: 1, key: toChainedReference(1) },
                    ],
                  }),
                  encodeManageUserBalance({
                    ops: [
                      {
                        kind: UserBalanceOpKind.TransferInternal,
                        asset: tokens.DAI.address,
                        amount: toChainedReference(0),
                        sender: relayer.address,
                        recipient: TypesConverter.toAddress(sender),
                      },
                      {
                        kind: UserBalanceOpKind.TransferInternal,
                        asset: tokens.SNX.address,
                        amount: toChainedReference(1),
                        sender: relayer.address,
                        recipient: TypesConverter.toAddress(recipient),
                      },
                    ],
                  }),
                ]),
              tokens,
              [
                {
                  account: TypesConverter.toAddress(sender),
                  changes: {
                    DAI: amountDAI,
                    SNX: 0,
                  },
                },
                {
                  account: TypesConverter.toAddress(recipient),
                  changes: {
                    DAI: 0,
                    SNX: amountSNX,
                  },
                },
              ],
              vault.instance // Pass this so that `expectBalanceChange` compares *internal* balances
            )
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(sender),
            token: tokens.DAI.address,
            delta: amountDAI,
          });
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(relayer),
            token: tokens.DAI.address,
            delta: amountDAI,
          });
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(relayer),
            token: tokens.SNX.address,
            delta: amountSNX,
          });
          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(recipient),
            token: tokens.SNX.address,
            delta: amountSNX,
          });
        });

        it('allows emergency exit', async () => {
          const BPT = (await getBPT(poolIdA)).get(0).instance;
          BPT.connect(user).transfer(TypesConverter.toAddress(sender), await BPT.balanceOf(user.address));

          const amountInBPT = fp(1);

          // Exit Pool A (DAI, MKR) to internal balance
          // Pretend MKR is bricked (i.e., external transfers fail)
          // Swap *internally* with Pool B MKR -> SNX
          // Withdraw SNX back out to wallet
          // So external token balances of DAI/MKR should be unchanged, and SNX should equal token out from swap
          const receipt = await (
            await relayer.connect(user).multicall([
              encodeExitPool(vault, relayerLibrary, tokens, {
                poolKind: PoolKind.WEIGHTED,
                poolId: poolIdA,
                userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amountInBPT),
                toInternalBalance: true,
                outputReferences: {
                  DAI: toChainedReference(0),
                  MKR: toChainedReference(1),
                },
                sender,
                recipient: relayer.address,
              }),
              encodeBatchSwap({
                relayerLibrary,
                tokens,
                swaps: [{ poolId: poolIdB, tokenIn: tokens.MKR, tokenOut: tokens.SNX, amount: toChainedReference(1) }],
                outputReferences: {
                  SNX: toChainedReference(1),
                },
                sender: relayer.address,
                recipient: TypesConverter.toAddress(sender),
                useInternalBalance: true,
              }),
              encodeManageUserBalance({
                ops: [
                  {
                    kind: UserBalanceOpKind.WithdrawInternal,
                    asset: tokens.SNX.address,
                    amount: toChainedReference(1),
                    sender,
                  },
                ],
              }),
            ])
          ).wait();

          let daiAmountOut = Zero;

          const daiTransfer = expectEvent.inIndirectReceipt(
            receipt,
            vault.instance.interface,
            'InternalBalanceChanged',
            {
              user: TypesConverter.toAddress(relayer),
              token: tokens.DAI.address,
            }
          );

          daiAmountOut = daiTransfer.args.delta;

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'InternalBalanceChanged', {
            user: TypesConverter.toAddress(relayer),
            token: tokens.MKR.address,
          });

          const snxTransfer = expectEvent.inIndirectReceipt(
            receipt,
            vault.instance.interface,
            'InternalBalanceChanged',
            {
              user: TypesConverter.toAddress(sender),
              token: tokens.SNX.address,
            }
          );

          const snxAmountWithdrawn = snxTransfer.args.delta;

          const {
            args: { amountOut: amountOutSNX },
          } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdB });

          await expectChainedReferenceContents(relayer, toChainedReference(0), daiAmountOut);
          expect(snxAmountWithdrawn).to.eq(amountOutSNX);

          // Check for the actual SNX withdrawal (in addition to the Swap event from the Vault)
          expectEvent.inIndirectReceipt(receipt, tokens.SNX.instance.interface, 'Transfer', {
            from: vault.address,
            to: TypesConverter.toAddress(recipient),
            value: amountOutSNX,
          });

          // SNX should be in recipient's account.
          expect(await tokens.SNX.balanceOf(recipient)).to.eq(amountOutSNX);
        });
      }
    });
  });
});
