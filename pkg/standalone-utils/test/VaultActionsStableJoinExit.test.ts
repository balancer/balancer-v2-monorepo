import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { BasePoolEncoder, getPoolAddress, StablePoolEncoder } from '@balancer-labs/balancer-js';
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
  PoolKind,
  approveVaultForRelayer,
  getJoinExitAmounts,
  encodeSwap,
} from './VaultActionsRelayer.setup';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('Vault Actions - Stable Pools', () => {
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let user: SignerWithAddress, admin: SignerWithAddress, other: SignerWithAddress;
  let recipient: Account;
  let poolIdStable: string;
  let poolIdStable2: string;
  let bptIndex: number;
  let bptIndex2: number;
  let stablePool: StablePool;

  before('setup environment', async () => {
    ({ user, admin, other, vault, relayer, relayerLibrary } = await setupRelayerEnvironment());
  });

  before('setup common recipient', () => {
    // All the tests use the same recipient; this is a simple abstraction to improve readability.
    recipient = randomAddress();
  });

  sharedBeforeEach('set up pools', async () => {
    tokens = (await TokenList.create(['DAI', 'CDAI'])).sort();
    await tokens.mint({ to: user, amount: fp(1000) });
    await tokens.approve({ to: vault, from: user });

    stablePool = await StablePool.create({
      tokens,
      vault,
    });

    bptIndex = await stablePool.getBptIndex();
    const equalBalances = Array.from({ length: tokens.length + 1 }).map((_, i) => (i == bptIndex ? 0 : fp(1000)));
    await stablePool.init({ recipient: user.address, initialBalances: equalBalances, from: user });

    poolIdStable = await stablePool.getPoolId();
    // Create a second one with the same tokens, for chaining
    const stablePool2 = await StablePool.create({
      tokens,
      vault,
    });

    bptIndex2 = await stablePool2.getBptIndex();
    const equalBalances2 = Array.from({ length: tokens.length + 1 }).map((_, i) => (i == bptIndex2 ? 0 : fp(1000)));
    await stablePool2.init({ recipient: user.address, initialBalances: equalBalances2, from: user });

    poolIdStable2 = await stablePool2.getPoolId();
  });

  describe('join pool', () => {
    const amountInDAI = fp(2);
    const amountInCDAI = fp(5);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([
            await encodeJoinPool(vault, relayerLibrary, {
              poolKind: PoolKind.COMPOSABLE_STABLE_V2,
              poolId: poolIdStable,
              userData: '0x',
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
        beforeEach(async () => {
          sender = user;
          await tokens.approve({ to: vault, from: user });
        });

        itTestsStableJoin();
      });

      context('sender = relayer', () => {
        sharedBeforeEach('fund relayer with tokens and approve vault', async () => {
          sender = relayer;
          await tokens.DAI.transfer(relayer, amountInDAI, { from: user });
          await tokens.CDAI.transfer(relayer, amountInCDAI, { from: user });
          await approveVaultForRelayer(relayerLibrary, user, tokens);
        });

        itTestsStableJoin();
      });

      function itTestsStableJoin() {
        describe('exact tokens in for bpt out', () => {
          it('joins with immediate amounts', async () => {
            await expectBalanceChange(
              async () =>
                relayer.connect(user).multicall([
                  await encodeJoinPool(vault, relayerLibrary, {
                    poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                    poolId: poolIdStable,
                    userData: StablePoolEncoder.joinExactTokensInForBPTOut(
                      getJoinExitAmounts(tokens, { DAI: amountInDAI, CDAI: amountInCDAI }),
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
                  CDAI: amountInCDAI.mul(-1),
                },
              }
            );
          });

          it('stores BPT amount out as chained reference', async () => {
            const receipt = await (
              await relayer.connect(user).multicall([
                await encodeJoinPool(vault, relayerLibrary, {
                  poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                  poolId: poolIdStable,
                  userData: StablePoolEncoder.joinExactTokensInForBPTOut(
                    getJoinExitAmounts(tokens, { DAI: amountInDAI, CDAI: amountInCDAI }),
                    0
                  ),
                  outputReference: toChainedReference(0),
                  sender,
                  recipient,
                }),
              ])
            ).wait();

            const {
              args: { value: BPTAmountOut },
            } = expectTransferEvent(
              receipt,
              { from: ZERO_ADDRESS, to: TypesConverter.toAddress(recipient) },
              getPoolAddress(poolIdStable)
            );

            await expectChainedReferenceContents(relayer, toChainedReference(0), BPTAmountOut);
          });

          it('joins with exact amounts in chained references', async () => {
            await setChainedReferenceContents(relayer, toChainedReference(0), amountInCDAI);

            await expectBalanceChange(
              async () =>
                relayer.connect(user).multicall([
                  await encodeJoinPool(vault, relayerLibrary, {
                    poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                    poolId: poolIdStable,
                    userData: StablePoolEncoder.joinExactTokensInForBPTOut(
                      getJoinExitAmounts(tokens, { DAI: amountInDAI, CDAI: toChainedReference(0) }),
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
                  CDAI: amountInCDAI.mul(-1),
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
                      poolId: poolIdStable,
                      tokenIn: tokens.CDAI,
                      tokenOut: tokens.DAI,
                      amount: amountInCDAI,
                      outputReference: toChainedReference(0),
                      sender,
                      recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next join.
                    }),
                    encodeJoinPool(vault, relayerLibrary, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable2,
                      userData: StablePoolEncoder.joinExactTokensInForBPTOut(
                        getJoinExitAmounts(tokens, { DAI: toChainedReference(0) }),
                        0
                      ),
                      sender,
                      recipient,
                    }),
                  ]),
                tokens,
                { account: TypesConverter.toAddress(sender), changes: { CDAI: amountInCDAI.mul(-1) } }
              )
            ).wait();

            const {
              args: { amountOut: amountOutDAI },
            } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdStable });

            const {
              args: { deltas },
            } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
              poolId: poolIdStable2,
            });

            // For a composable pool, indexes need to be adjusted for BPT, as deltas will include it
            const daiIndex = tokens.indexOf(tokens.DAI);
            const cdaiIndex = tokens.indexOf(tokens.CDAI);

            expect(deltas[daiIndex < bptIndex2 ? daiIndex : daiIndex + 1]).to.equal(amountOutDAI);
            expect(deltas[cdaiIndex < bptIndex2 ? cdaiIndex : cdaiIndex + 1]).to.equal(0);
          });
        });

        describe('token in for exact bpt out', () => {
          it('joins with immediate amounts', async () => {
            const bptOut = fp(0.2);
            const daiIndex = tokens.indexOf(tokens.DAI);

            await expectBalanceChange(
              async () =>
                relayer.connect(user).multicall([
                  await encodeJoinPool(vault, relayerLibrary, {
                    poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                    poolId: poolIdStable,
                    userData: StablePoolEncoder.joinTokenInForExactBPTOut(bptOut, daiIndex),
                    sender,
                    recipient,
                  }),
                ]),
              tokens,
              {
                account: TypesConverter.toAddress(sender),
                changes: {
                  DAI: ['near', bptOut.mul(-1)], // In a balanced pool, BPT should roughly represent the underlying tokens
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
                    poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                    poolId: poolIdStable,
                    userData: StablePoolEncoder.joinAllTokensInForExactBptOut(bptOut),
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
                  CDAI: ['near', bptOut.div(2).mul(-1)],
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
              poolKind: PoolKind.COMPOSABLE_STABLE_V2,
              poolId: poolIdStable,
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

      context('sender = user', () => {
        beforeEach(async () => {
          sender = user;
          await tokens.approve({ to: vault, from: user });
        });

        itTestsStableExit();
      });

      context('sender = relayer', () => {
        sharedBeforeEach('fund relayer with BPT and approve vault', async () => {
          sender = relayer;
          const BPT = (await getBPT(poolIdStable)).get(0).instance;
          BPT.connect(user).transfer(TypesConverter.toAddress(sender), await BPT.balanceOf(user.address));

          await approveVaultForRelayer(relayerLibrary, user, tokens);
        });

        itTestsStableExit();
      });

      function itTestsStableExit() {
        describe('exit to external balance', () => {
          const toInternalBalance = false;
          testExitStablePool(toInternalBalance);
        });

        describe('exit to internal balance', () => {
          const toInternalBalance = true;
          testExitStablePool(toInternalBalance);
        });

        function testExitStablePool(useInternalBalance: boolean): void {
          describe('exact bpt in for tokens', () => {
            it('exits with immediate amounts', async () => {
              await expectBalanceChange(
                async () =>
                  relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable,
                      userData: StablePoolEncoder.exitExactBptInForTokensOut(fp(1)),
                      toInternalBalance: useInternalBalance,
                      sender,
                      recipient,
                    }),
                  ]),
                await getBPT(poolIdStable),
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
                    poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                    poolId: poolIdStable,
                    userData: StablePoolEncoder.exitExactBptInForTokensOut(amountInBPT),
                    toInternalBalance: useInternalBalance,
                    outputReferences: {
                      DAI: toChainedReference(0),
                      CDAI: toChainedReference(1),
                    },
                    sender,
                    recipient,
                  }),
                ])
              ).wait();

              let daiAmountOut = Zero;
              let cdaiAmountOut = Zero;
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
                const cdaiTransfer = expectEvent.inIndirectReceipt(
                  receipt,
                  vault.instance.interface,
                  'InternalBalanceChanged',
                  {
                    user: TypesConverter.toAddress(recipient),
                    token: tokens.CDAI.address,
                  }
                );

                daiAmountOut = daiTransfer.args.delta;
                cdaiAmountOut = cdaiTransfer.args.delta;
              } else {
                const daiTransfer = expectTransferEvent(
                  receipt,
                  { from: vault.address, to: TypesConverter.toAddress(recipient) },
                  tokens.DAI
                );
                const cdaiTransfer = expectTransferEvent(
                  receipt,
                  { from: vault.address, to: TypesConverter.toAddress(recipient) },
                  tokens.CDAI
                );

                daiAmountOut = daiTransfer.args.value;
                cdaiAmountOut = cdaiTransfer.args.value;
              }

              await expectChainedReferenceContents(relayer, toChainedReference(0), daiAmountOut);
              await expectChainedReferenceContents(relayer, toChainedReference(1), cdaiAmountOut);
            });

            it('exits with exact bpt in chained reference', async () => {
              await setChainedReferenceContents(relayer, toChainedReference(0), amountInBPT);

              await expectBalanceChange(
                async () =>
                  relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable,
                      userData: StablePoolEncoder.exitExactBptInForTokensOut(toChainedReference(0)),
                      toInternalBalance: useInternalBalance,
                      sender,
                      recipient,
                    }),
                  ]),
                await getBPT(poolIdStable),
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
                        poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                        poolId: poolIdStable,
                        userData: StablePoolEncoder.exitExactBptInForTokensOut(amountInBPT),
                        toInternalBalance: useInternalBalance,
                        outputReferences: {
                          CDAI: toChainedReference(0),
                        },
                        sender,
                        recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next swap.
                      }),
                      encodeSwap(relayerLibrary, {
                        poolId: poolIdStable,
                        tokenIn: tokens.CDAI,
                        tokenOut: tokens.DAI,
                        fromInternalBalance: useInternalBalance,
                        amount: toChainedReference(0),
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdStable),
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
                poolId: poolIdStable,
              });

              const {
                args: { amountIn: amountInCDAI },
              } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdStable });

              const cdaiIndex = tokens.indexOf(tokens.CDAI);
              expect(deltas[cdaiIndex < bptIndex ? cdaiIndex : cdaiIndex + 1].mul(-1)).to.equal(amountInCDAI);
            });
          });

          describe('exact bpt in for one token', () => {
            it('exits with immediate amounts', async () => {
              await expectBalanceChange(
                async () =>
                  relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable,
                      userData: StablePoolEncoder.exitExactBPTInForOneTokenOut(fp(1), 0),
                      toInternalBalance: useInternalBalance,
                      sender,
                      recipient,
                    }),
                  ]),
                await getBPT(poolIdStable),
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
                    poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                    poolId: poolIdStable,
                    userData: StablePoolEncoder.exitExactBPTInForOneTokenOut(
                      amountInBPT,
                      tokens.findIndexBySymbol('CDAI')
                    ),
                    toInternalBalance: useInternalBalance,
                    outputReferences: {
                      CDAI: toChainedReference(0),
                    },
                    sender,
                    recipient,
                  }),
                ])
              ).wait();

              let cdaiAmountOut = Zero;
              if (useInternalBalance) {
                const cdaiTransfer = expectEvent.inIndirectReceipt(
                  receipt,
                  vault.instance.interface,
                  'InternalBalanceChanged',
                  {
                    user: TypesConverter.toAddress(recipient),
                    token: tokens.CDAI.address,
                  }
                );

                cdaiAmountOut = cdaiTransfer.args.delta;
              } else {
                const cdaiTransfer = expectTransferEvent(
                  receipt,
                  { from: vault.address, to: TypesConverter.toAddress(recipient) },
                  tokens.CDAI
                );

                cdaiAmountOut = cdaiTransfer.args.value;
              }

              await expectChainedReferenceContents(relayer, toChainedReference(0), cdaiAmountOut);
            });

            it('exits with exact bpt in chained reference', async () => {
              await setChainedReferenceContents(relayer, toChainedReference(0), amountInBPT);

              await expectBalanceChange(
                async () =>
                  relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable,
                      userData: StablePoolEncoder.exitExactBPTInForOneTokenOut(
                        toChainedReference(0),
                        tokens.findIndexBySymbol('CDAI')
                      ),
                      toInternalBalance: useInternalBalance,
                      sender,
                      recipient,
                    }),
                  ]),
                await getBPT(poolIdStable),
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
                        poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                        poolId: poolIdStable,
                        userData: StablePoolEncoder.exitExactBPTInForOneTokenOut(
                          amountInBPT,
                          tokens.findIndexBySymbol('CDAI')
                        ),
                        toInternalBalance: useInternalBalance,
                        outputReferences: {
                          CDAI: toChainedReference(0),
                        },
                        sender,
                        recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next swap.
                      }),
                      encodeSwap(relayerLibrary, {
                        poolId: poolIdStable,
                        tokenIn: tokens.CDAI,
                        tokenOut: tokens.DAI,
                        amount: toChainedReference(0),
                        fromInternalBalance: useInternalBalance,
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdStable),
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
                poolId: poolIdStable,
              });

              const {
                args: { amountIn: amountInCDAI },
              } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdStable });

              const cdaiIndex = tokens.indexOf(tokens.CDAI);
              expect(deltas[cdaiIndex < bptIndex ? cdaiIndex : cdaiIndex + 1].mul(-1)).to.equal(amountInCDAI);
            });
          });

          describe('bpt in for exact tokens out', () => {
            const amountOutCDAI = fp(1);
            const amountOutDAI = fp(2);

            it('exits with immediate amounts', async () => {
              await expectBalanceChange(
                async () =>
                  relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable,
                      userData: StablePoolEncoder.exitBPTInForExactTokensOut(
                        [amountOutCDAI, amountOutDAI],
                        MAX_UINT256
                      ),
                      toInternalBalance: useInternalBalance,
                      sender,
                      recipient,
                    }),
                  ]),
                await getBPT(poolIdStable),
                {
                  account: TypesConverter.toAddress(sender),
                  changes: {
                    BPT: ['lt', 0],
                    CDAI: amountOutCDAI,
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

  describe('exit pool in recovery mode', () => {
    const amountInBPT = fp(1);

    async function getBPT(poolId: string): Promise<TokenList> {
      return new TokenList([await Token.deployedAt(getPoolAddress(poolId))]);
    }

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          relayer.connect(other).multicall([
            await encodeExitPool(vault, relayerLibrary, tokens, {
              poolKind: PoolKind.COMPOSABLE_STABLE_V2,
              poolId: poolIdStable,
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
        await stablePool.enableRecoveryMode(admin);

        expect(await stablePool.inRecoveryMode()).to.be.true;
      });

      context('sender = user', () => {
        beforeEach(async () => {
          sender = user;
          await tokens.approve({ to: vault, from: user });
        });

        itTestsStableRecoveryModeExit();
      });

      context('sender = relayer', () => {
        sharedBeforeEach('fund relayer with BPT and approve vault', async () => {
          sender = relayer;
          const BPT = (await getBPT(poolIdStable)).get(0).instance;
          BPT.connect(user).transfer(TypesConverter.toAddress(sender), await BPT.balanceOf(user.address));

          await approveVaultForRelayer(relayerLibrary, user, tokens);
        });

        itTestsStableRecoveryModeExit();
      });

      function itTestsStableRecoveryModeExit() {
        describe('exit to external balance', () => {
          const toInternalBalance = false;
          testExitRecoveryModeStablePool(toInternalBalance);
        });

        describe('exit to internal balance', () => {
          const toInternalBalance = true;
          testExitRecoveryModeStablePool(toInternalBalance);
        });

        function testExitRecoveryModeStablePool(useInternalBalance: boolean): void {
          describe('exact bpt in for all tokens', () => {
            it('exits with immediate amounts', async () => {
              await expectBalanceChange(
                async () =>
                  relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable,
                      userData: BasePoolEncoder.recoveryModeExit(fp(1)),
                      toInternalBalance: useInternalBalance,
                      sender,
                      recipient,
                    }),
                  ]),
                await getBPT(poolIdStable),
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
                    poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                    poolId: poolIdStable,
                    userData: BasePoolEncoder.recoveryModeExit(amountInBPT),
                    toInternalBalance: useInternalBalance,
                    outputReferences: {
                      DAI: toChainedReference(0),
                      CDAI: toChainedReference(1),
                    },
                    sender,
                    recipient,
                  }),
                ])
              ).wait();

              let daiAmountOut = Zero;
              let cdaiAmountOut = Zero;
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
                const cdaiTransfer = expectEvent.inIndirectReceipt(
                  receipt,
                  vault.instance.interface,
                  'InternalBalanceChanged',
                  {
                    user: TypesConverter.toAddress(recipient),
                    token: tokens.CDAI.address,
                  }
                );

                daiAmountOut = daiTransfer.args.delta;
                cdaiAmountOut = cdaiTransfer.args.delta;
              } else {
                const daiTransfer = expectTransferEvent(
                  receipt,
                  { from: vault.address, to: TypesConverter.toAddress(recipient) },
                  tokens.DAI
                );
                const cdaiTransfer = expectTransferEvent(
                  receipt,
                  { from: vault.address, to: TypesConverter.toAddress(recipient) },
                  tokens.CDAI
                );

                daiAmountOut = daiTransfer.args.value;
                cdaiAmountOut = cdaiTransfer.args.value;
              }

              await expectChainedReferenceContents(relayer, toChainedReference(0), daiAmountOut);
              await expectChainedReferenceContents(relayer, toChainedReference(1), cdaiAmountOut);
            });

            it('exits with exact bpt in chained reference', async () => {
              await setChainedReferenceContents(relayer, toChainedReference(0), amountInBPT);

              await expectBalanceChange(
                async () =>
                  relayer.connect(user).multicall([
                    await encodeExitPool(vault, relayerLibrary, tokens, {
                      poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                      poolId: poolIdStable,
                      userData: BasePoolEncoder.recoveryModeExit(toChainedReference(0)),
                      toInternalBalance: useInternalBalance,
                      sender,
                      recipient,
                    }),
                  ]),
                await getBPT(poolIdStable),
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
                        poolKind: PoolKind.COMPOSABLE_STABLE_V2,
                        poolId: poolIdStable,
                        userData: BasePoolEncoder.recoveryModeExit(amountInBPT),
                        toInternalBalance: useInternalBalance,
                        outputReferences: {
                          CDAI: toChainedReference(0),
                        },
                        sender,
                        recipient: TypesConverter.toAddress(sender), // Override default recipient to chain the output with the next swap.
                      }),
                      encodeSwap(relayerLibrary, {
                        poolId: poolIdStable,
                        tokenIn: tokens.CDAI,
                        tokenOut: tokens.DAI,
                        fromInternalBalance: useInternalBalance,
                        amount: toChainedReference(0),
                        sender,
                        recipient,
                      }),
                    ]),
                  await getBPT(poolIdStable),
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
                poolId: poolIdStable,
              });

              const {
                args: { amountIn: amountInCDAI },
              } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdStable });

              const cdaiIndex = tokens.indexOf(tokens.CDAI);
              expect(deltas[cdaiIndex < bptIndex ? cdaiIndex : cdaiIndex + 1].mul(-1)).to.equal(amountInCDAI);
            });
          });
        }
      }
    });
  });
  describe('unhandled pool types', () => {
    const INVALID_POOL_KIND = PoolKind.COMPOSABLE_STABLE_V2 + 1;
    const sender = randomAddress();

    context('on joins', () => {
      const bptOut = fp(2);

      it('does not support invalid pool types on joins', async () => {
        await expect(
          relayer.connect(user).multicall([
            await encodeJoinPool(vault, relayerLibrary, {
              poolKind: INVALID_POOL_KIND,
              poolId: poolIdStable,
              userData: StablePoolEncoder.joinAllTokensInForExactBptOut(bptOut),
              sender,
              recipient,
            }),
          ])
        ).to.be.revertedWith('LOW_LEVEL_CALL_FAILED');
      });
    });

    context('on exits', () => {
      const bptIn = fp(2);

      it('does not support invalid pool types on exits', async () => {
        await expect(
          relayer.connect(user).multicall([
            await encodeExitPool(vault, relayerLibrary, tokens, {
              poolKind: INVALID_POOL_KIND,
              poolId: poolIdStable,
              toInternalBalance: false,
              userData: StablePoolEncoder.exitExactBptInForTokensOut(bptIn),
              sender,
              recipient,
            }),
          ])
        ).to.be.revertedWith('LOW_LEVEL_CALL_FAILED');
      });
    });
  });
});
