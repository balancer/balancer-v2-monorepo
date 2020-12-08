import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { Dictionary } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { PairTS, TupleTS } from '../../scripts/helpers/pools';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { TradingStrategyType } from '../../scripts/helpers/pools';
import { FundManagement, Swap, toSwapIn, toSwapOut } from '../../scripts/helpers/trading';

import { MAX_UINT128, ZERO_ADDRESS } from '../helpers/constants';
import { BigNumberish, Comparison } from '../helpers/tokenBalance';

type SwapData = {
  pool?: number; // Index in the poolIds array
  amount: number;
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
};

describe('Vault - swaps', () => {
  let vault: Contract, funds: FundManagement;
  let tokens: TokenList, tokenAddresses: string[];
  let poolIds: string[], poolId: string, anotherPoolId: string;
  let admin: SignerWithAddress, lp: SignerWithAddress, trader: SignerWithAddress, other: SignerWithAddress;


  before('setup', async () => {
    [, admin, lp, trader, other] = await ethers.getSigners();

    // This suite contains a very large number of tests, so we don't redeploy all contracts for each single test. This
    // means tests are not fully independent, and may affect each other (e.g. if they use very large amounts of tokens,
    // or rely on user balance or operators).

    vault = await deploy('Vault', { args: [admin.address] });
    tokens = await deployTokens(admin.address, ['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    for (const symbol in tokens) {
      // lp tokens are used to seed pools
      await tokens[symbol].mint(lp.address, MAX_UINT128.div(2));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT128);

      await tokens[symbol].mint(trader.address, MAX_UINT128.div(2));
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT128);
    }
  });

  beforeEach('set up default sender', async () => {
    funds = {
      sender: trader.address,
      recipient: trader.address,
      withdrawFromUserBalance: false,
      depositToUserBalance: false,
    };
  });

  context('with two tokens', () => {
    const symbols = ['DAI', 'MKR'];

    context('with a pair trading strategy', () => {
      const type = PairTS;

      context('with a two-token storage layout', () => {
        // TODO: implement deployment script for a two-token storage pool
        // itHandlesSwapsProperly(type, symbols);
      });

      context('with a multi-token storage layout', () => {
        itHandlesSwapsProperly(type, symbols);
      });
    });

    context('with a tuple trading strategy', () => {
      const type = TupleTS;

      itHandlesSwapsProperly(type, symbols);
    });
  });

  context('with three tokens', () => {
    const symbols = ['DAI', 'MKR', 'SNX'];

    context('with a pair trading strategy', () => {
      const type = PairTS;

      itHandlesSwapsProperly(type, symbols);
    });

    context('with a tuple trading strategy', () => {
      const type = TupleTS;

      itHandlesSwapsProperly(type, symbols);
    });
  });

  function parseSwap(input: SwapInput): Swap[] {
    return input.swaps.map((data) => ({
      poolId: poolIds[data.pool ?? 0],
      amount: data.amount.toString(),
      tokenInIndex: data.in,
      tokenOutIndex: data.out,
      userData: data.data ?? '0x',
    }));
  }

  async function deployPool(type: TradingStrategyType, tokenSymbols: string[]): Promise<string> {
    const pool = await deploy('MockPool', { args: [vault.address, type] });
    await pool.setMultiplier(toFixedPoint(2));

    // Let the pool use the lp's tokens, and add liquidity
    await vault.connect(lp).authorizeOperator(pool.address);

    const tokenAddresses = tokenSymbols.map((symbol) => tokens[symbol].address);
    const tokenAmounts = tokenSymbols.map(() => (100e18).toString());

    await pool.connect(lp).addLiquidity(tokenAddresses, tokenAmounts);

    return pool.getPoolId();
  }

  function deployMainPool(type: TradingStrategyType, tokenSymbols: string[]) {
    beforeEach('deploy main pool', async () => {
      poolId = await deployPool(type, tokenSymbols);
      poolIds = [poolId];
    });
  }

  function deployAnotherPool(type: TradingStrategyType, tokenSymbols: string[]) {
    beforeEach('deploy secondary pool', async () => {
      anotherPoolId = await deployPool(type, tokenSymbols);
      poolIds.push(anotherPoolId);
    });
  }

  function itHandlesSwapsProperly(type: TradingStrategyType, tokenSymbols: string[]) {
    deployMainPool(type, tokenSymbols);

    describe('swap given in', () => {
      const assertSwapGivenIn = (input: SwapInput, changes?: Dictionary<BigNumberish | Comparison>) => {
        it('trades the expected amount', async () => {
          const sender = input.fromOther ? other : trader;
          const recipient = input.toOther ? other : trader;
          const swaps = toSwapIn(parseSwap(input));

          await expectBalanceChange(
            () => vault.connect(sender).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds),
            tokens,
            [{ account: recipient, changes }]
          );
        });
      };

      const assertSwapGivenInReverts = (input: SwapInput, reason?: string) => {
        it('reverts', async () => {
          const sender = input.fromOther ? other : trader;
          const swaps = toSwapIn(parseSwap(input));
          const call = vault.connect(sender).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);

          reason ? await expect(call).to.be.revertedWith(reason) : await expect(call).to.be.reverted;
        });
      };

      context('for a single swap', () => {
        context('when an amount is specified', () => {
          context('when the given token is in the pool', () => {
            context('when the requested token is in the pool', () => {
              context('when requesting another token', () => {
                context('when requesting a reasonable amount', () => {
                  // Send 1 MKR, get 2 DAI back
                  const swaps = [{ in: 1, out: 0, amount: 1e18 }];

                  context('when the sender is using his own tokens', () => {
                    context('when using external balance', () => {
                      assertSwapGivenIn({ swaps }, { DAI: 2e18, MKR: -1e18 });
                    });

                    context('when withdrawing from user balance', () => {
                      context.skip('when using less than available as user balance', () => {
                        // TODO: add tests where no token transfers are needed and user balance remains
                      });

                      context('when using more than available as user balance', () => {
                        beforeEach('deposit to user balance', async () => {
                          funds.withdrawFromUserBalance = true;
                          await vault.connect(trader).deposit(tokens.MKR.address, (0.3e18).toString(), trader.address);
                        });

                        assertSwapGivenIn({ swaps }, { DAI: 2e18, MKR: -0.7e18 });
                      });
                    });

                    context('when depositing from user balance', () => {
                      beforeEach('deposit to user balance', async () => {
                        funds.depositToUserBalance = true;
                      });

                      assertSwapGivenIn({ swaps }, { MKR: -1e18 });
                    });
                  });

                  context('when the sender is using tokens from other user', () => {
                    const fromOther = true;

                    context('when the sender is allowed as an operator', async () => {
                      beforeEach('authorize operator', async () => {
                        await vault.connect(trader).authorizeOperator(other.address);
                      });

                      assertSwapGivenIn({ swaps, fromOther }, { DAI: 2e18, MKR: -1e18 });
                    });

                    context('when the sender is not allowed as an operator', async () => {
                      beforeEach('revoke operator', async () => {
                        await vault.connect(trader).revokeOperator(other.address);
                      });

                      assertSwapGivenInReverts({ swaps, fromOther }, 'Caller is not operator');
                    });
                  });
                });

                context('when draining the pool', () => {
                  const swaps = [{ in: 1, out: 0, amount: 50e18 }];

                  assertSwapGivenInReverts({ swaps }, 'Fully draining token out');
                });

                context('when requesting more than the available balance', () => {
                  const swaps = [{ in: 1, out: 0, amount: 100e18 }];

                  assertSwapGivenInReverts({ swaps }, 'ERR_SUB_UNDERFLOW');
                });
              });

              context('when the requesting the same token', () => {
                const swaps = [{ in: 1, out: 1, amount: 1e18 }];

                assertSwapGivenInReverts({ swaps }, 'Swap for same token');
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

        context('when no amount is specified', () => {
          const swaps = [{ in: 1, out: 0, amount: 0 }];

          assertSwapGivenInReverts({ swaps }, 'Unknown amount in on first swap');
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

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

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
                    beforeEach('tweak the main pool to give back as much as it receives', async () => {
                      const [poolAddress] = (await vault.getPool(poolIds[0])) as [string, unknown];
                      const pool = await ethers.getContractAt('MockPool', poolAddress);
                      await pool.setMultiplier(toFixedPoint(1));
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

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                context('with a two-token storage layout', () => {
                  // TODO: implement deployment script for a two-token storage pool
                  itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
                });

                context('with a multi-token storage layout', () => {
                  itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
                });
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

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

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
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

              assertSwapGivenInReverts({ swaps }, 'Misconstructed multihop swap');
            });
          });

          context('with another pool', () => {
            context('with two tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

                const swaps = [
                  // Send 1 MKR, get 2 DAI back
                  { pool: 0, in: 1, out: 0, amount: 1e18 },
                  // Send the previously acquired 2 DAI, get 4 MKR back
                  { pool: 1, in: 0, out: 1, amount: 0 },
                ];

                assertSwapGivenIn({ swaps }, { MKR: 3e18 });
              };

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                context('with a two-token storage layout', () => {
                  // TODO: implement deployment script for a two-token storage pool
                  itHandleMultiSwapsWithHopsProperly(anotherPoolType);
                });

                context('with a multi-token storage layout', () => {
                  itHandleMultiSwapsWithHopsProperly(anotherPoolType);
                });
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithHopsProperly(anotherPoolType);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

                const swaps = [
                  // Send 1 MKR, get 2 DAI back
                  { pool: 0, in: 1, out: 0, amount: 1e18 },
                  // Send the previously acquired 2 DAI, get 4 SNX back
                  { pool: 1, in: 0, out: 2, amount: 0 },
                ];

                assertSwapGivenIn({ swaps }, { SNX: 4e18, MKR: -1e18 });
              };

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                itHandleMultiSwapsWithHopsProperly(anotherPoolType);
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithHopsProperly(anotherPoolType);
              });
            });
          });
        });
      });
    });

    describe('swap given out', () => {
      const assertSwapGivenOut = (input: SwapInput, changes?: Dictionary<BigNumberish | Comparison>) => {
        it('trades the expected amount', async () => {
          const sender = input.fromOther ? other : trader;
          const recipient = input.toOther ? other : trader;
          const swaps = toSwapOut(parseSwap(input));

          await expectBalanceChange(
            () => vault.connect(sender).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds),
            tokens,
            [{ account: recipient, changes }]
          );
        });
      };

      const assertSwapGivenOutReverts = (input: SwapInput, reason?: string) => {
        it('reverts', async () => {
          const sender = input.fromOther ? other : trader;
          const swaps = toSwapOut(parseSwap(input));
          const call = vault.connect(sender).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);

          reason ? await expect(call).to.be.revertedWith(reason) : await expect(call).to.be.reverted;
        });
      };

      context('for a single swap', () => {
        context('when an amount is specified', () => {
          context('when the given token is in the pool', () => {
            context('when the requested token is in the pool', () => {
              context('when the requesting another token', () => {
                context('when requesting a reasonable amount', () => {
                  // Get 1e18 DAI by sending 0.5e18 MKR
                  const swaps = [{ in: 1, out: 0, amount: 1e18 }];

                  context('when the sender is using his own tokens', () => {
                    context('when using external balance', () => {
                      assertSwapGivenOut({ swaps }, { DAI: 1e18, MKR: -0.5e18 });
                    });

                    context('when withdrawing from user balance', () => {
                      context.skip('when using less than available as user balance', () => {
                        // TODO: add tests where no token transfers are needed and user balance remains
                      });

                      context('when using more than available as user balance', () => {
                        beforeEach('deposit to user balance', async () => {
                          funds.withdrawFromUserBalance = true;
                          await vault.connect(trader).deposit(tokens.MKR.address, (0.3e18).toString(), trader.address);
                        });

                        assertSwapGivenOut({ swaps }, { DAI: 1e18, MKR: -0.2e18 });
                      });
                    });

                    context('when depositing from user balance', () => {
                      beforeEach('deposit to user balance', async () => {
                        funds.depositToUserBalance = true;
                      });

                      assertSwapGivenOut({ swaps }, { MKR: -0.5e18 });
                    });
                  });

                  context('when the sender is using tokens from other user', () => {
                    context('when the sender is allowed as an operator', async () => {
                      beforeEach('authorize operator', async () => {
                        await vault.connect(trader).authorizeOperator(other.address);
                      });

                      assertSwapGivenOut({ swaps, fromOther: true }, { DAI: 1e18, MKR: -0.5e18 });
                    });

                    context('when the sender is not allowed as an operator', async () => {
                      beforeEach('revoke operator', async () => {
                        await vault.connect(trader).revokeOperator(other.address);
                      });

                      assertSwapGivenOutReverts({ swaps, fromOther: true }, 'Caller is not operator');
                    });
                  });
                });

                context('when draining the pool', () => {
                  const swaps = [{ in: 1, out: 0, amount: 100e18 }];

                  assertSwapGivenOutReverts({ swaps }, 'Fully draining token out');
                });

                context('when requesting more than the available balance', () => {
                  const swaps = [{ in: 1, out: 0, amount: 200e18 }];

                  assertSwapGivenOutReverts({ swaps }, 'ERR_SUB_UNDERFLOW');
                });
              });

              context('when the requesting the same token', () => {
                const swaps = [{ in: 1, out: 1, amount: 1e18 }];

                assertSwapGivenOutReverts({ swaps }, 'Swap for same token');
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

        context('when no amount is specified', () => {
          const swaps = [{ in: 1, out: 0, amount: 0 }];

          assertSwapGivenOutReverts({ swaps }, 'Unknown amount in on first swap');
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

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

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
                      const [poolAddress] = (await vault.getPool(poolIds[0])) as [string, unknown];
                      const pool = await ethers.getContractAt('MockPool', poolAddress);
                      await pool.setMultiplier(toFixedPoint(1));
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

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                context('with a two-token storage layout', () => {
                  // TODO: implement deployment script for a two-token storage pool
                  itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
                });

                context('with a multi-token storage layout', () => {
                  itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
                });
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

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

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithoutHopsProperly(anotherPoolType);
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

              assertSwapGivenOutReverts({ swaps }, 'Misconstructed multihop swap');
            });
          });

          context('with another pool', () => {
            context('with two tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

                const swaps = [
                  // Get 1 MKR by sending 0.5 DAI
                  { pool: 0, in: 0, out: 1, amount: 1e18 },
                  // Get the previously required amount of 0.5 DAI by sending 0.25 MKR
                  { pool: 1, in: 1, out: 0, amount: 0 },
                ];

                assertSwapGivenOut({ swaps }, { MKR: 0.75e18 });
              };

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                context('with a two-token storage layout', () => {
                  // TODO: implement deployment script for a two-token storage pool
                  itHandleMultiSwapsWithHopsProperly(anotherPoolType);
                });

                context('with a multi-token storage layout', () => {
                  itHandleMultiSwapsWithHopsProperly(anotherPoolType);
                });
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithHopsProperly(anotherPoolType);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolType: TradingStrategyType) => {
                deployAnotherPool(anotherPoolType, anotherPoolSymbols);

                const swaps = [
                  // Get 1 MKR by sending 0.5 DAI
                  { pool: 0, in: 0, out: 1, amount: 1e18 },
                  // Get the previously required amount of 0.5 DAI by sending 0.25 SNX
                  { pool: 1, in: 2, out: 0, amount: 0 },
                ];

                assertSwapGivenOut({ swaps }, { MKR: 1e18, SNX: -0.25e18 });
              };

              context('with a pair trading strategy', () => {
                const anotherPoolType = PairTS;

                itHandleMultiSwapsWithHopsProperly(anotherPoolType);
              });

              context('with a tuple trading strategy', () => {
                const anotherPoolType = TupleTS;

                itHandleMultiSwapsWithHopsProperly(anotherPoolType);
              });
            });
          });
        });
      });
    });
  }
});
