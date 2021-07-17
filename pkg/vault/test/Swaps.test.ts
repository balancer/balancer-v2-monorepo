import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Dictionary } from 'lodash';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList, { ETH_TOKEN_ADDRESS } from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { Comparison, expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';

import {
  BatchSwapStep,
  FundManagement,
  SingleSwap,
  SwapKind,
  PoolSpecialization,
  RelayerAuthorization,
} from '@balancer-labs/balancer-js';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import {
  MAX_GAS_LIMIT,
  MAX_INT256,
  MAX_UINT112,
  MAX_UINT256,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from '@balancer-labs/v2-helpers/src/constants';

type SwapData = {
  pool?: number; // Index in the poolIds array
  amount: number | BigNumber;
  in: number; // Index in the tokens array
  out: number; // Index in the tokens array
  data?: string;
  fromOther?: boolean;
  toOther?: boolean;
};

type SwapInput = {
  swaps: SwapData[];
  fromOther?: boolean;
  toOther?: boolean;
  signature?: boolean | string;
};

describe('Swaps', () => {
  let vault: Contract, authorizer: Contract, funds: FundManagement;
  let tokens: TokenList;
  let mainPoolId: string, secondaryPoolId: string;
  let lp: SignerWithAddress, trader: SignerWithAddress, other: SignerWithAddress, admin: SignerWithAddress;

  const poolInitialBalance = bn(50e18);

  before('setup', async () => {
    [, lp, trader, other, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and tokens', async () => {
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'WETH']);

    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, tokens.WETH.address, 0, 0] });

    await tokens.mint({ to: [lp, trader], amount: bn(200e18) });
    await tokens.approve({ to: vault, from: [lp, trader], amount: MAX_UINT112 });
  });

  beforeEach('set up default sender', async () => {
    funds = {
      sender: trader.address,
      recipient: trader.address,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  context('with two tokens', () => {
    const symbols = ['DAI', 'MKR'];

    context('with a general pool', () => {
      itHandlesSwapsProperly(PoolSpecialization.GeneralPool, symbols);
    });

    context('with a minimal swap info pool', () => {
      itHandlesSwapsProperly(PoolSpecialization.MinimalSwapInfoPool, symbols);
    });

    context('with a two token pool', () => {
      itHandlesSwapsProperly(PoolSpecialization.TwoTokenPool, symbols);
    });
  });

  context('with three tokens', () => {
    const symbols = ['DAI', 'MKR', 'SNX'];

    context('with a general pool', () => {
      itHandlesSwapsProperly(PoolSpecialization.GeneralPool, symbols);
    });

    context('with a minimal swap info pool', () => {
      itHandlesSwapsProperly(PoolSpecialization.MinimalSwapInfoPool, symbols);
    });
  });

  context('when one of the assets is ETH', () => {
    // We only do givenIn tests, as givenIn and givenOut are presumed to be identical as they relate to this feature

    const symbols = ['DAI', 'WETH'];
    let tokenAddresses: string[];

    const limits = Array(symbols.length).fill(MAX_INT256);
    const deadline = MAX_UINT256;

    beforeEach(() => {
      tokenAddresses = [ETH_TOKEN_ADDRESS, tokens.DAI.address];
    });

    context('with minimal swap info pool', () => {
      sharedBeforeEach('setup pool', async () => {
        mainPoolId = await deployPool(PoolSpecialization.GeneralPool, symbols);
      });

      itSwapsWithETHCorrectly();
    });

    context('with general pool', () => {
      sharedBeforeEach('setup pool', async () => {
        mainPoolId = await deployPool(PoolSpecialization.MinimalSwapInfoPool, symbols);
      });

      itSwapsWithETHCorrectly();
    });

    function itSwapsWithETHCorrectly() {
      let sender: SignerWithAddress;

      context('when the sender is the trader', () => {
        beforeEach(() => {
          sender = trader;
        });

        it('received ETH is wrapped into WETH', async () => {
          const swaps = [
            {
              poolId: mainPoolId,
              assetInIndex: 0, // ETH
              assetOutIndex: 1,
              amount: bn(1e18),
              userData: '0x',
            },
          ];

          await expectBalanceChange(
            () =>
              vault
                .connect(sender)
                .batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline, { value: bn(1e18) }),
            tokens,
            [
              { account: vault, changes: { WETH: 1e18, DAI: -2e18 } },
              { account: trader, changes: { DAI: 2e18 } },
            ]
          );
        });

        it('sent WETH is unwrapped into ETH', async () => {
          const swaps = [
            {
              poolId: mainPoolId,
              assetInIndex: 1,
              assetOutIndex: 0, // ETH
              amount: bn(1e18),
              userData: '0x',
            },
          ];

          const traderBalanceBefore = await ethers.provider.getBalance(trader.address);

          const gasPrice = 1;
          const receipt: ContractReceipt = await (
            await expectBalanceChange(
              () =>
                vault
                  .connect(sender)
                  .batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline, { gasPrice }),
              tokens,
              [
                { account: vault, changes: { WETH: -2e18, DAI: 1e18 } },
                { account: trader, changes: { DAI: -1e18 } },
              ]
            )
          ).wait();
          const ethSpent = receipt.gasUsed.mul(gasPrice);

          const traderBalanceAfter = await ethers.provider.getBalance(trader.address);

          expect(traderBalanceAfter.sub(traderBalanceBefore)).to.equal(bn(2e18).sub(ethSpent));
        });

        it('emits an event with WETH as the token address', async () => {
          const swaps = [
            {
              poolId: mainPoolId,
              assetInIndex: 0, // ETH
              assetOutIndex: 1,
              amount: bn(1e18),
              userData: '0x',
            },

            {
              poolId: mainPoolId,
              assetInIndex: 1,
              assetOutIndex: 0, // ETH
              amount: bn(1e18),
              userData: '0x',
            },
          ];

          const receipt = await (
            await vault.connect(sender).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline)
          ).wait();

          expectEvent.inReceipt(receipt, 'Swap', {
            poolId: mainPoolId,
            tokenIn: tokens.WETH.address,
            tokenOut: tokens.DAI.address,
            amountIn: bn(1e18),
            amountOut: bn(2e18),
          });

          expectEvent.inReceipt(receipt, 'Swap', {
            poolId: mainPoolId,
            tokenIn: tokens.DAI.address,
            tokenOut: tokens.WETH.address,
            amountIn: bn(1e18),
            amountOut: bn(2e18),
          });
        });

        it('reverts if less ETH than required was supplied', async () => {
          const swaps = [
            {
              poolId: mainPoolId,
              assetInIndex: 0, // ETH
              assetOutIndex: 1,
              amount: bn(1e18),
              userData: '0x',
            },
          ];

          await expect(
            vault
              .connect(sender)
              .batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline, { value: bn(1e18).sub(1) })
          ).to.be.revertedWith('INSUFFICIENT_ETH');
        });

        it('returns excess ETH if more ETH than required was supplied', async () => {
          const swaps = [
            {
              poolId: mainPoolId,
              assetInIndex: 0, // ETH
              assetOutIndex: 1,
              amount: bn(1e18),
              userData: '0x',
            },
          ];

          const previousBalance = await ethers.provider.getBalance(sender.address);

          const gasPrice = 1;
          const receipt: ContractReceipt = await (
            await vault.connect(sender).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline, {
              value: bn(1e18).add(42), // Only 1e18 is required
              gasPrice,
            })
          ).wait();

          const ethSpent = receipt.gasUsed.mul(gasPrice);

          const currentBalance = await ethers.provider.getBalance(sender.address);
          expect(previousBalance.sub(currentBalance)).to.equal(ethSpent.add(bn(1e18)));
        });
      });

      context('when the sender is an approved relayer', () => {
        sharedBeforeEach(async () => {
          const action = await actionId(vault, 'batchSwap');
          await authorizer.connect(admin).grantRole(action, other.address);

          await vault.connect(trader).setRelayerApproval(trader.address, other.address, true);
        });

        it('returns excess sent ETH to the relayer', async () => {
          const swaps = [
            {
              poolId: mainPoolId,
              assetInIndex: 0, // ETH
              assetOutIndex: 1,
              amount: bn(1e18),
              userData: '0x',
            },
          ];

          const relayerBalanceBefore = await ethers.provider.getBalance(other.address);

          const gasPrice = 1;
          const receipt: ContractReceipt = await (
            await vault.connect(other).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline, {
              value: bn(1e18).add(42), // Only 1e18 is required
              gasPrice,
            })
          ).wait();
          const ethSpent = receipt.gasUsed.mul(gasPrice);

          const relayerBalanceAfter = await ethers.provider.getBalance(other.address);

          expect(relayerBalanceBefore.sub(relayerBalanceAfter)).to.equal(ethSpent.add(bn(1e18)));
        });

        it('returns unreceived ETH to the relayer', async () => {
          const swaps = [
            {
              poolId: mainPoolId,
              assetInIndex: 1,
              assetOutIndex: 0, // ETH
              amount: bn(1e18),
              userData: '0x',
            },
          ];

          const relayerBalanceBefore = await ethers.provider.getBalance(other.address);

          const gasPrice = 1;
          const receipt: ContractReceipt = await (
            await vault.connect(other).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline, {
              value: 42,
              gasPrice,
            })
          ).wait();
          const ethSpent = receipt.gasUsed.mul(gasPrice);

          const relayerBalanceAfter = await ethers.provider.getBalance(other.address);

          expect(relayerBalanceBefore.sub(relayerBalanceAfter)).to.equal(ethSpent);
        });
      });
    }
  });

  function toBatchSwap(input: SwapInput): BatchSwapStep[] {
    return input.swaps.map((data) => ({
      poolId: ((data.pool ?? 0) == 0 ? mainPoolId : secondaryPoolId) || ZERO_BYTES32,
      amount: data.amount.toString(),
      assetInIndex: data.in,
      assetOutIndex: data.out,
      userData: data.data ?? '0x',
    }));
  }

  function toSingleSwap(kind: SwapKind, input: SwapInput): SingleSwap {
    const data = toBatchSwap(input)[0];
    return {
      kind,
      poolId: data.poolId,
      amount: data.amount,
      assetIn: tokens.addresses[data.assetInIndex] || ZERO_ADDRESS,
      assetOut: tokens.addresses[data.assetOutIndex] || ZERO_ADDRESS,
      userData: data.userData,
    };
  }

  async function deployPool(specialization: PoolSpecialization, tokenSymbols: string[]): Promise<string> {
    const pool = await deploy('MockPool', { args: [vault.address, specialization] });
    await pool.setMultiplier(fp(2));

    // Register tokens
    const sortedTokenAddresses = tokenSymbols
      .map((symbol) => tokens.findBySymbol(symbol))
      .sort((tokenA, tokenB) => tokenA.compare(tokenB))
      .map((token) => token.address);

    const assetManagers = sortedTokenAddresses.map(() => ZERO_ADDRESS);

    await pool.connect(lp).registerTokens(sortedTokenAddresses, assetManagers);

    // Join the pool - the actual amount is not relevant since the MockPool relies on the multiplier to calculate prices
    const tokenAmounts = sortedTokenAddresses.map(() => poolInitialBalance);

    const poolId = pool.getPoolId();
    await vault.connect(lp).joinPool(poolId, lp.address, other.address, {
      assets: sortedTokenAddresses,
      maxAmountsIn: tokenAmounts,
      fromInternalBalance: false,
      userData: encodeJoin(tokenAmounts, Array(sortedTokenAddresses.length).fill(0)),
    });

    return poolId;
  }

  function deployMainPool(specialization: PoolSpecialization, tokenSymbols: string[]) {
    sharedBeforeEach('deploy main pool', async () => {
      mainPoolId = await deployPool(specialization, tokenSymbols);
    });
  }

  function deployAnotherPool(specialization: PoolSpecialization, tokenSymbols: string[]) {
    sharedBeforeEach('deploy secondary pool', async () => {
      secondaryPoolId = await deployPool(specialization, tokenSymbols);
    });
  }

  function itHandlesSwapsProperly(specialization: PoolSpecialization, tokenSymbols: string[]) {
    deployMainPool(specialization, tokenSymbols);

    describe('swap given in', () => {
      const assertSwapGivenIn = (
        input: SwapInput,
        changes?: Dictionary<BigNumberish | Comparison>,
        expectedInternalBalance?: Dictionary<BigNumberish>
      ) => {
        const isSingleSwap = input.swaps.length === 1;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assertSwap = async (data: string, sender: SignerWithAddress, expectedChanges: any[]): Promise<void> => {
          // Hardcoding a gas limit prevents (slow) gas estimation
          await expectBalanceChange(
            () => sender.sendTransaction({ to: vault.address, data, gasLimit: MAX_GAS_LIMIT }),
            tokens,
            expectedChanges
          );

          if (expectedInternalBalance) {
            for (const symbol in expectedInternalBalance) {
              const token = tokens.findBySymbol(symbol);
              const internalBalance = await vault.getInternalBalance(sender.address, [token.address]);
              expect(internalBalance[0]).to.be.equal(bn(expectedInternalBalance[symbol]));
            }
          }
        };

        if (isSingleSwap) {
          it('trades the expected amount (single)', async () => {
            const sender = input.fromOther ? other : trader;
            const recipient = input.toOther ? other : trader;
            const swap = toSingleSwap(SwapKind.GivenIn, input);

            let calldata = vault.interface.encodeFunctionData('swap', [swap, funds, 0, MAX_UINT256]);

            if (input.signature) {
              const nonce = await vault.getNextNonce(trader.address);
              const authorization = await RelayerAuthorization.signSwapAuthorization(
                vault,
                trader,
                sender.address,
                calldata,
                MAX_UINT256,
                nonce
              );
              const signature = typeof input.signature === 'string' ? input.signature : authorization;
              calldata = RelayerAuthorization.encodeCalldataAuthorization(calldata, MAX_UINT256, signature);
            }

            await assertSwap(calldata, sender, [{ account: recipient, changes }]);
          });
        }

        it(`trades the expected amount ${isSingleSwap ? '(batch)' : ''}`, async () => {
          const sender = input.fromOther ? other : trader;
          const recipient = input.toOther ? other : trader;
          const swaps = toBatchSwap(input);
          const limits = Array(tokens.length).fill(MAX_INT256);

          const args = [SwapKind.GivenIn, swaps, tokens.addresses, funds, limits, MAX_UINT256];
          let calldata = vault.interface.encodeFunctionData('batchSwap', args);

          if (input.signature) {
            const nonce = await vault.getNextNonce(trader.address);
            const authorization = await RelayerAuthorization.signBatchSwapAuthorization(
              vault,
              trader,
              sender.address,
              calldata,
              MAX_UINT256,
              nonce
            );
            const signature = typeof input.signature === 'string' ? input.signature : authorization;
            calldata = RelayerAuthorization.encodeCalldataAuthorization(calldata, MAX_UINT256, signature);
          }

          await assertSwap(calldata, sender, [{ account: recipient, changes }]);
        });
      };

      const assertSwapGivenInReverts = (input: SwapInput, defaultReason?: string, singleSwapReason = defaultReason) => {
        const isSingleSwap = input.swaps.length === 1;

        if (isSingleSwap) {
          it(`reverts ${isSingleSwap ? '(single)' : ''}`, async () => {
            const sender = input.fromOther ? other : trader;
            const swap = toSingleSwap(SwapKind.GivenIn, input);
            const call = vault.connect(sender).swap(swap, funds, MAX_UINT256, MAX_UINT256);

            singleSwapReason
              ? await expect(call).to.be.revertedWith(singleSwapReason)
              : await expect(call).to.be.reverted;
          });
        }

        it(`reverts ${isSingleSwap ? '(batch)' : ''}`, async () => {
          const sender = input.fromOther ? other : trader;
          const swaps = toBatchSwap(input);

          const limits = Array(tokens.length).fill(MAX_INT256);
          const deadline = MAX_UINT256;

          const call = vault
            .connect(sender)
            .batchSwap(SwapKind.GivenIn, swaps, tokens.addresses, funds, limits, deadline);
          defaultReason ? await expect(call).to.be.revertedWith(defaultReason) : await expect(call).to.be.reverted;
        });
      };

      context('for a single swap', () => {
        context('when the pool is registered', () => {
          context('when an amount is specified', () => {
            context('when the given indexes are valid', () => {
              context('when the given token is in the pool', () => {
                context('when the requested token is in the pool', () => {
                  context('when requesting another token', () => {
                    context('when requesting a reasonable amount', () => {
                      // Send 1 MKR, get 2 DAI back
                      const swaps = [{ in: 1, out: 0, amount: 1e18 }];

                      context('when using managed balance', () => {
                        context('when the sender is the user', () => {
                          const fromOther = false;

                          assertSwapGivenIn({ swaps, fromOther }, { DAI: 2e18, MKR: -1e18 });
                        });

                        context('when the sender is a relayer', () => {
                          const fromOther = true;

                          context('when the relayer is whitelisted by the authorizer', () => {
                            sharedBeforeEach('grant permission to relayer', async () => {
                              const single = await actionId(vault, 'swap');
                              const batch = await actionId(vault, 'batchSwap');
                              await authorizer.connect(admin).grantRoles([single, batch], other.address);
                            });

                            context('when the relayer is allowed by the user', () => {
                              sharedBeforeEach('allow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, true);
                              });

                              assertSwapGivenIn({ swaps, fromOther }, { DAI: 2e18, MKR: -1e18 });
                            });

                            context('when the relayer is not allowed by the user', () => {
                              sharedBeforeEach('disallow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, false);
                              });

                              context('when the relayer has a valid signature from the user', () => {
                                assertSwapGivenIn({ swaps, fromOther, signature: true }, { DAI: 2e18, MKR: -1e18 });
                              });

                              context('when the relayer has an invalid signature from the user', () => {
                                assertSwapGivenInReverts(
                                  { swaps, fromOther, signature: ZERO_BYTES32 },
                                  'USER_DOESNT_ALLOW_RELAYER'
                                );
                              });

                              context('when there is no signature', () => {
                                assertSwapGivenInReverts({ swaps, fromOther }, 'USER_DOESNT_ALLOW_RELAYER');
                              });
                            });
                          });

                          context('when the relayer is not whitelisted by the authorizer', () => {
                            sharedBeforeEach('revoke permission from relayer', async () => {
                              const single = await actionId(vault, 'swap');
                              const batch = await actionId(vault, 'batchSwap');
                              await authorizer.connect(admin).revokeRoles([single, batch], other.address);
                            });

                            context('when the relayer is allowed by the user', () => {
                              sharedBeforeEach('allow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, true);
                              });

                              assertSwapGivenInReverts({ swaps, fromOther }, 'SENDER_NOT_ALLOWED');
                            });

                            context('when the relayer is not allowed by the user', () => {
                              sharedBeforeEach('disallow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, false);
                              });

                              assertSwapGivenInReverts({ swaps, fromOther }, 'SENDER_NOT_ALLOWED');
                            });
                          });
                        });
                      });

                      context('when withdrawing from internal balance', () => {
                        beforeEach(() => {
                          funds.fromInternalBalance = true;
                        });

                        context('when using less than available as internal balance', () => {
                          sharedBeforeEach('deposit to internal balance', async () => {
                            await vault.connect(trader).manageUserBalance([
                              {
                                kind: 0, // deposit
                                asset: tokens.DAI.address,
                                amount: bn(1e18),
                                sender: trader.address,
                                recipient: trader.address,
                              },
                              {
                                kind: 0, // deposit
                                asset: tokens.MKR.address,
                                amount: bn(1e18),
                                sender: trader.address,
                                recipient: trader.address,
                              },
                            ]);
                          });

                          assertSwapGivenIn({ swaps }, { DAI: 2e18 }, { MKR: 0, DAI: 1e18 });
                        });

                        context('when using more than available as internal balance', () => {
                          sharedBeforeEach('deposit to internal balance', async () => {
                            await vault.connect(trader).manageUserBalance([
                              {
                                kind: 0, // deposit
                                asset: tokens.MKR.address,
                                amount: bn(0.3e18),
                                sender: trader.address,
                                recipient: trader.address,
                              },
                            ]);
                          });

                          assertSwapGivenIn({ swaps }, { DAI: 2e18, MKR: -0.7e18 }, { MKR: 0 });
                        });
                      });

                      context('when depositing from internal balance', () => {
                        beforeEach(() => {
                          funds.toInternalBalance = true;
                        });

                        assertSwapGivenIn({ swaps }, { MKR: -1e18 });
                      });
                    });

                    context('when draining the pool', () => {
                      const swaps = [{ in: 1, out: 0, amount: poolInitialBalance.div(2) }];

                      assertSwapGivenIn({ swaps }, { DAI: poolInitialBalance, MKR: poolInitialBalance.div(2).mul(-1) });
                    });

                    context('when requesting more than the available balance', () => {
                      const swaps = [{ in: 1, out: 0, amount: poolInitialBalance.div(2).add(1) }];

                      assertSwapGivenInReverts({ swaps }, 'SUB_OVERFLOW');
                    });
                  });

                  context('when the requesting the same token', () => {
                    const swaps = [{ in: 1, out: 1, amount: 1e18 }];

                    assertSwapGivenInReverts({ swaps }, 'CANNOT_SWAP_SAME_TOKEN');
                  });
                });

                context('when the requested token is not in the pool', () => {
                  const swaps = [{ in: 1, out: 3, amount: 1e18 }];

                  assertSwapGivenInReverts({ swaps });
                });
              });

              context('when the given token is not in the pool', () => {
                const swaps = [{ in: 3, out: 1, amount: 1e18 }];

                assertSwapGivenInReverts({ swaps });
              });
            });

            context('when the given indexes are not valid', () => {
              context('when the token index in is not valid', () => {
                const swaps = [{ in: 30, out: 1, amount: 1e18 }];

                assertSwapGivenInReverts({ swaps }, 'OUT_OF_BOUNDS', 'TOKEN_NOT_REGISTERED');
              });

              context('when the token index out is not valid', () => {
                const swaps = [{ in: 0, out: 10, amount: 1e18 }];

                assertSwapGivenInReverts({ swaps }, 'OUT_OF_BOUNDS', 'TOKEN_NOT_REGISTERED');
              });
            });
          });

          context('when no amount is specified', () => {
            const swaps = [{ in: 1, out: 0, amount: 0 }];

            assertSwapGivenInReverts({ swaps }, 'UNKNOWN_AMOUNT_IN_FIRST_SWAP');
          });
        });

        context('when the pool is not registered', () => {
          const swaps = [{ pool: 1000, in: 1, out: 0, amount: 1e18 }];

          assertSwapGivenInReverts({ swaps }, 'INVALID_POOL_ID');
        });
      });

      context('for a multi swap', () => {
        context('without hops', () => {
          context('with the same pool', () => {
            const swaps = [
              // Send 1 MKR, get 2 DAI back
              { in: 1, out: 0, amount: 1e18 },
              // Send 2 DAI, get 4 MKR back
              { in: 0, out: 1, amount: 2e18 },
            ];

            assertSwapGivenIn({ swaps }, { MKR: 3e18 });
          });

          context('with another pool', () => {
            context('with two tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                context('for a single pair', () => {
                  const swaps = [
                    // In each pool, send 1e18 MKR, get 2e18 DAI back
                    { pool: 0, in: 1, out: 0, amount: 1e18 },
                    { pool: 1, in: 1, out: 0, amount: 1e18 },
                  ];

                  assertSwapGivenIn({ swaps }, { DAI: 4e18, MKR: -2e18 });
                });

                context('for a multi pair', () => {
                  context('when pools offer same price', () => {
                    const swaps = [
                      // Send 1 MKR, get 2 DAI back
                      { pool: 0, in: 1, out: 0, amount: 1e18 },
                      // Send 2 DAI, get 4 MKR back
                      { pool: 1, in: 0, out: 1, amount: 2e18 },
                    ];

                    assertSwapGivenIn({ swaps }, { MKR: 3e18 });
                  });

                  context('when pools do not offer same price', () => {
                    sharedBeforeEach('tweak the main pool to give back as much as it receives', async () => {
                      const [poolAddress] = (await vault.getPool(mainPoolId)) as [string, unknown];
                      const pool = await deployedAt('MockPool', poolAddress);
                      await pool.setMultiplier(fp(1));
                    });

                    beforeEach('tweak sender and recipient to be other address', async () => {
                      // The caller will receive profit in MKR, since it sold DAI for more MKR than it bought it for.
                      // The caller receives tokens and doesn't send any.
                      // Note the caller didn't even have any tokens to begin with.
                      funds.sender = other.address;
                      funds.recipient = other.address;
                    });

                    // Sell DAI in the pool where it is valuable, buy it in the one where it has a regular price
                    const swaps = [
                      // Sell 1e18 DAI for 2e18 MKR
                      { pool: 1, in: 0, out: 1, amount: 1e18 },
                      // Buy 2e18 DAI with 2e18 MKR
                      { pool: 0, in: 1, out: 0, amount: 1e18 },
                    ];

                    assertSwapGivenIn({ swaps, fromOther: true, toOther: true }, { MKR: 1e18 });
                  });
                });
              };
              context('with a general pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.MinimalSwapInfoPool);
              });

              context('with a two token pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                context('for a single pair', () => {
                  // In each pool, send 1e18 MKR, get 2e18 DAI back
                  const swaps = [
                    { pool: 0, in: 1, out: 0, amount: 1e18 },
                    { pool: 1, in: 1, out: 0, amount: 1e18 },
                  ];

                  assertSwapGivenIn({ swaps }, { DAI: 4e18, MKR: -2e18 });
                });

                context('for a multi pair', () => {
                  const swaps = [
                    // Send 1 MKR, get 2 DAI back
                    { pool: 0, in: 1, out: 0, amount: 1e18 },
                    // Send 2 DAI, get 4 SNX back
                    { pool: 1, in: 0, out: 2, amount: 2e18 },
                  ];

                  assertSwapGivenIn({ swaps }, { SNX: 4e18, MKR: -1e18 });
                });
              };

              context('with a general pool', () => {
                const anotherPoolSpecialization = PoolSpecialization.GeneralPool;
                itHandleMultiSwapsWithoutHopsProperly(anotherPoolSpecialization);
              });

              context('with a minimal swap info pool', () => {
                const anotherPoolSpecialization = PoolSpecialization.MinimalSwapInfoPool;
                itHandleMultiSwapsWithoutHopsProperly(anotherPoolSpecialization);
              });
            });
          });
        });

        context('with hops', () => {
          context('with the same pool', () => {
            context('when token in and out match', () => {
              const swaps = [
                // Send 1 MKR, get 2 DAI back
                { in: 1, out: 0, amount: 1e18 },
                // Send the previously acquired 2 DAI, get 4 MKR back
                { in: 0, out: 1, amount: 0 },
              ];

              assertSwapGivenIn({ swaps }, { MKR: 3e18 });
            });

            context('when token in and out mismatch', () => {
              const swaps = [
                // Send 1 MKR, get 2 DAI back
                { in: 1, out: 0, amount: 1e18 },
                // Send the previously acquired 2 DAI, get 4 MKR back
                { in: 1, out: 0, amount: 0 },
              ];

              assertSwapGivenInReverts({ swaps }, 'MALCONSTRUCTED_MULTIHOP_SWAP');
            });
          });

          context('with another pool', () => {
            context('with two tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                const swaps = [
                  // Send 1 MKR, get 2 DAI back
                  { pool: 0, in: 1, out: 0, amount: 1e18 },
                  // Send the previously acquired 2 DAI, get 4 MKR back
                  { pool: 1, in: 0, out: 1, amount: 0 },
                ];

                assertSwapGivenIn({ swaps }, { MKR: 3e18 });
              };

              context('with a general pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.MinimalSwapInfoPool);
              });

              context('with a two token pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                const swaps = [
                  // Send 1 MKR, get 2 DAI back
                  { pool: 0, in: 1, out: 0, amount: 1e18 },
                  // Send the previously acquired 2 DAI, get 4 SNX back
                  { pool: 1, in: 0, out: 2, amount: 0 },
                ];

                assertSwapGivenIn({ swaps }, { SNX: 4e18, MKR: -1e18 });
              };

              context('with a general pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.MinimalSwapInfoPool);
              });
            });
          });
        });
      });
    });

    describe('swap given out', () => {
      const assertSwapGivenOut = (
        input: SwapInput,
        changes?: Dictionary<BigNumberish | Comparison>,
        expectedInternalBalance?: Dictionary<BigNumberish>
      ) => {
        const isSingleSwap = input.swaps.length === 1;

        if (isSingleSwap) {
          it('trades the expected amount (single)', async () => {
            const sender = input.fromOther ? other : trader;
            const recipient = input.toOther ? other : trader;
            const swap = toSingleSwap(SwapKind.GivenOut, input);

            await expectBalanceChange(() => vault.connect(sender).swap(swap, funds, MAX_UINT256, MAX_UINT256), tokens, [
              { account: recipient, changes },
            ]);

            if (expectedInternalBalance) {
              for (const symbol in expectedInternalBalance) {
                const token = tokens.findBySymbol(symbol);
                const internalBalance = await vault.getInternalBalance(sender.address, [token.address]);
                expect(internalBalance[0]).to.be.equal(bn(expectedInternalBalance[symbol]));
              }
            }
          });
        }

        it(`trades the expected amount ${isSingleSwap ? '(batch)' : ''}`, async () => {
          const sender = input.fromOther ? other : trader;
          const recipient = input.toOther ? other : trader;
          const swaps = toBatchSwap(input);

          const limits = Array(tokens.length).fill(MAX_INT256);
          const deadline = MAX_UINT256;

          await expectBalanceChange(
            () => vault.connect(sender).batchSwap(SwapKind.GivenOut, swaps, tokens.addresses, funds, limits, deadline),
            tokens,
            [{ account: recipient, changes }]
          );

          if (expectedInternalBalance) {
            for (const symbol in expectedInternalBalance) {
              const token = tokens.findBySymbol(symbol);
              const internalBalance = await vault.getInternalBalance(sender.address, [token.address]);
              expect(internalBalance[0]).to.be.equal(bn(expectedInternalBalance[symbol]));
            }
          }
        });
      };

      const assertSwapGivenOutReverts = (
        input: SwapInput,
        defaultReason?: string,
        singleSwapReason = defaultReason
      ) => {
        const isSingleSwap = input.swaps.length === 1;

        if (isSingleSwap) {
          it(`reverts ${isSingleSwap ? '(single)' : ''}`, async () => {
            const sender = input.fromOther ? other : trader;
            const swap = toSingleSwap(SwapKind.GivenOut, input);
            const call = vault.connect(sender).swap(swap, funds, MAX_UINT256, MAX_UINT256);

            singleSwapReason
              ? await expect(call).to.be.revertedWith(singleSwapReason)
              : await expect(call).to.be.reverted;
          });
        }

        it(`reverts ${isSingleSwap ? '(batch)' : ''}`, async () => {
          const sender = input.fromOther ? other : trader;
          const swaps = toBatchSwap(input);

          const limits = Array(tokens.length).fill(MAX_INT256);
          const deadline = MAX_UINT256;

          const call = vault
            .connect(sender)
            .batchSwap(SwapKind.GivenOut, swaps, tokens.addresses, funds, limits, deadline);

          defaultReason ? await expect(call).to.be.revertedWith(defaultReason) : await expect(call).to.be.reverted;
        });
      };

      context('for a single swap', () => {
        context('when the pool is registered', () => {
          context('when an amount is specified', () => {
            context('when the given indexes are valid', () => {
              context('when the given token is in the pool', () => {
                context('when the requested token is in the pool', () => {
                  context('when the requesting another token', () => {
                    context('when requesting a reasonable amount', () => {
                      // Get 1e18 DAI by sending 0.5e18 MKR
                      const swaps = [{ in: 1, out: 0, amount: 1e18 }];

                      context('when using managed balance', () => {
                        context('when the sender is the user', () => {
                          const fromOther = false;

                          assertSwapGivenOut({ swaps, fromOther }, { DAI: 1e18, MKR: -0.5e18 });
                        });

                        context('when the sender is a relayer', () => {
                          const fromOther = true;

                          context('when the relayer is whitelisted by the authorizer', () => {
                            sharedBeforeEach('grant permission to relayer', async () => {
                              const single = await actionId(vault, 'swap');
                              const batch = await actionId(vault, 'batchSwap');
                              await authorizer.connect(admin).grantRoles([single, batch], other.address);
                            });

                            context('when the relayer is allowed by the user', () => {
                              sharedBeforeEach('allow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, true);
                              });

                              assertSwapGivenOut({ swaps, fromOther }, { DAI: 1e18, MKR: -0.5e18 });
                            });

                            context('when the relayer is not allowed by the user', () => {
                              sharedBeforeEach('disallow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, false);
                              });

                              assertSwapGivenOutReverts({ swaps, fromOther }, 'USER_DOESNT_ALLOW_RELAYER');
                            });
                          });

                          context('when the relayer is not whitelisted by the authorizer', () => {
                            sharedBeforeEach('revoke permission from relayer', async () => {
                              const single = await actionId(vault, 'swap');
                              const batch = await actionId(vault, 'batchSwap');
                              await authorizer.connect(admin).revokeRoles([single, batch], other.address);
                            });

                            context('when the relayer is allowed by the user', () => {
                              sharedBeforeEach('allow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, true);
                              });

                              assertSwapGivenOutReverts({ swaps, fromOther }, 'SENDER_NOT_ALLOWED');
                            });

                            context('when the relayer is not allowed by the user', () => {
                              sharedBeforeEach('disallow relayer', async () => {
                                await vault.connect(trader).setRelayerApproval(trader.address, other.address, false);
                              });

                              assertSwapGivenOutReverts({ swaps, fromOther }, 'SENDER_NOT_ALLOWED');
                            });
                          });
                        });
                      });

                      context('when withdrawing from internal balance', () => {
                        beforeEach(() => {
                          funds.fromInternalBalance = true;
                        });

                        context('when using less than available as internal balance', () => {
                          sharedBeforeEach('deposit to internal balance', async () => {
                            await vault.connect(trader).manageUserBalance([
                              {
                                kind: 0, // deposit
                                asset: tokens.DAI.address,
                                amount: bn(1e18),
                                sender: trader.address,
                                recipient: trader.address,
                              },
                              {
                                kind: 0, // deposit
                                asset: tokens.MKR.address,
                                amount: bn(0.5e18),
                                sender: trader.address,
                                recipient: trader.address,
                              },
                            ]);
                          });

                          assertSwapGivenOut({ swaps }, { DAI: 1e18 }, { MKR: 0, DAI: 1e18 });
                        });

                        context('when using more than available as internal balance', () => {
                          sharedBeforeEach('deposit to internal balance', async () => {
                            await vault.connect(trader).manageUserBalance([
                              {
                                kind: 0, // deposit
                                asset: tokens.MKR.address,
                                amount: bn(0.3e18),
                                sender: trader.address,
                                recipient: trader.address,
                              },
                            ]);
                          });

                          assertSwapGivenOut({ swaps }, { DAI: 1e18, MKR: -0.2e18 });
                        });
                      });

                      context('when depositing from internal balance', () => {
                        beforeEach(() => {
                          funds.toInternalBalance = true;
                        });

                        assertSwapGivenOut({ swaps }, { MKR: -0.5e18 });
                      });
                    });

                    context('when draining the pool', () => {
                      const swaps = [{ in: 1, out: 0, amount: poolInitialBalance }];

                      assertSwapGivenOut(
                        { swaps },
                        { DAI: poolInitialBalance, MKR: poolInitialBalance.div(2).mul(-1) }
                      );
                    });

                    context('when requesting more than the available balance', () => {
                      const swaps = [{ in: 1, out: 0, amount: poolInitialBalance.add(1) }];

                      assertSwapGivenOutReverts({ swaps }, 'SUB_OVERFLOW');
                    });
                  });

                  context('when the requesting the same token', () => {
                    const swaps = [{ in: 1, out: 1, amount: 1e18 }];

                    assertSwapGivenOutReverts({ swaps }, 'CANNOT_SWAP_SAME_TOKEN');
                  });
                });

                context('when the requested token is not in the pool', () => {
                  const swaps = [{ in: 1, out: 3, amount: 1e18 }];

                  assertSwapGivenOutReverts({ swaps });
                });
              });

              context('when the given token is not in the pool', () => {
                const swaps = [{ in: 3, out: 1, amount: 1e18 }];

                assertSwapGivenOutReverts({ swaps });
              });
            });

            context('when the given indexes are not valid', () => {
              context('when the token index in is not valid', () => {
                const swaps = [{ in: 30, out: 1, amount: 1e18 }];

                assertSwapGivenOutReverts({ swaps }, 'OUT_OF_BOUNDS', 'TOKEN_NOT_REGISTERED');
              });

              context('when the token index out is not valid', () => {
                const swaps = [{ in: 0, out: 10, amount: 1e18 }];

                assertSwapGivenOutReverts({ swaps }, 'OUT_OF_BOUNDS', 'TOKEN_NOT_REGISTERED');
              });
            });
          });

          context('when no amount is specified', () => {
            const swaps = [{ in: 1, out: 0, amount: 0 }];

            assertSwapGivenOutReverts({ swaps }, 'UNKNOWN_AMOUNT_IN_FIRST_SWAP');
          });
        });

        context('when the pool is not registered', () => {
          const swaps = [{ pool: 1000, in: 1, out: 0, amount: 1e18 }];

          assertSwapGivenOutReverts({ swaps }, 'INVALID_POOL_ID');
        });
      });

      context('for a multi swap', () => {
        context('without hops', () => {
          context('with the same pool', () => {
            const swaps = [
              // Get 1 DAI by sending 0.5 MKR
              { in: 1, out: 0, amount: 1e18 },
              // Get 2 MKR by sending 1 DAI
              { in: 0, out: 1, amount: 2e18 },
            ];

            assertSwapGivenOut({ swaps }, { MKR: 1.5e18 });
          });

          context('with another pool', () => {
            context('with two tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                context('for a single pair', () => {
                  // In each pool, get 1e18 DAI by sending 0.5e18 MKR
                  const swaps = [
                    { pool: 0, in: 1, out: 0, amount: 1e18 },
                    { pool: 1, in: 1, out: 0, amount: 1e18 },
                  ];

                  assertSwapGivenOut({ swaps }, { DAI: 2e18, MKR: -1e18 });
                });

                context('for a multi pair', () => {
                  context('when pools offer same price', () => {
                    const swaps = [
                      // Get 1 DAI by sending 0.5 MKR
                      { pool: 0, in: 1, out: 0, amount: 1e18 },
                      // Get 2 MKR by sending 1 DAI
                      { pool: 1, in: 0, out: 1, amount: 2e18 },
                    ];

                    assertSwapGivenOut({ swaps }, { MKR: 1.5e18 });
                  });

                  context('when pools do not offer same price', () => {
                    beforeEach('tweak the main pool to give back as much as it receives', async () => {
                      const [poolAddress] = (await vault.getPool(mainPoolId)) as [string, unknown];
                      const pool = await deployedAt('MockPool', poolAddress);
                      await pool.setMultiplier(fp(1));
                    });

                    beforeEach('tweak sender and recipient to be other address', async () => {
                      // The caller will receive profit in MKR, since it sold DAI for more MKR than it bought it for.
                      // The caller receives tokens and doesn't send any.
                      // Note the caller didn't even have any tokens to begin with.
                      funds.sender = other.address;
                      funds.recipient = other.address;
                    });

                    // Sell DAI in the pool where it is valuable, buy it in the one where it has a regular price
                    const swaps = [
                      // Sell 1 DAI for 2 MKR
                      { pool: 1, in: 0, out: 1, amount: 2e18 },
                      // Buy 1 DAI with 1 MKR
                      { pool: 0, in: 1, out: 0, amount: 1e18 },
                    ];

                    assertSwapGivenOut({ swaps, fromOther: true, toOther: true }, { MKR: 1e18 });
                  });
                });
              };

              context('with a general pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.MinimalSwapInfoPool);
              });
              context('with a two token pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                context('for a single pair', () => {
                  // In each pool, get 1e18 DAI by sending 0.5e18 MKR
                  const swaps = [
                    { pool: 0, in: 1, out: 0, amount: 1e18 },
                    { pool: 1, in: 1, out: 0, amount: 1e18 },
                  ];

                  assertSwapGivenOut({ swaps }, { DAI: 2e18, MKR: -1e18 });
                });

                context('for a multi pair', () => {
                  const swaps = [
                    // Get 1 DAI by sending 0.5 MKR
                    { pool: 0, in: 1, out: 0, amount: 1e18 },
                    // Get 1 SNX by sending 0.5 MKR
                    { pool: 1, in: 1, out: 2, amount: 1e18 },
                  ];

                  assertSwapGivenOut({ swaps }, { DAI: 1e18, SNX: 1e18, MKR: -1e18 });
                });
              };

              context('with a general pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(PoolSpecialization.MinimalSwapInfoPool);
              });
            });
          });
        });

        context('with hops', () => {
          context('with the same pool', () => {
            context('when token in and out match', () => {
              const swaps = [
                // Get 1 MKR by sending 0.5 DAI
                { in: 0, out: 1, amount: 1e18 },
                // Get the previously required amount of 0.5 DAI by sending 0.25 MKR
                { in: 1, out: 0, amount: 0 },
              ];

              assertSwapGivenOut({ swaps }, { MKR: 0.75e18 });
            });

            context('when token in and out mismatch', () => {
              const swaps = [
                { in: 1, out: 0, amount: 1e18 },
                { in: 1, out: 0, amount: 0 },
              ];

              assertSwapGivenOutReverts({ swaps }, 'MALCONSTRUCTED_MULTIHOP_SWAP');
            });
          });

          context('with another pool', () => {
            context('with two tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                const swaps = [
                  // Get 1 MKR by sending 0.5 DAI
                  { pool: 0, in: 0, out: 1, amount: 1e18 },
                  // Get the previously required amount of 0.5 DAI by sending 0.25 MKR
                  { pool: 1, in: 1, out: 0, amount: 0 },
                ];

                assertSwapGivenOut({ swaps }, { MKR: 0.75e18 });
              };

              context('with a general pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.MinimalSwapInfoPool);
              });

              context('with a two token pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecialization) => {
                deployAnotherPool(anotherPoolSpecialization, anotherPoolSymbols);

                const swaps = [
                  // Get 1 MKR by sending 0.5 DAI
                  { pool: 0, in: 0, out: 1, amount: 1e18 },
                  // Get the previously required amount of 0.5 DAI by sending 0.25 SNX
                  { pool: 1, in: 2, out: 0, amount: 0 },
                ];

                assertSwapGivenOut({ swaps }, { MKR: 1e18, SNX: -0.25e18 });
              };

              context('with a general pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(PoolSpecialization.MinimalSwapInfoPool);
              });
            });
          });
        });
      });
    });
  }
});
