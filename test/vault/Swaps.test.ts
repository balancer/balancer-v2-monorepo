import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { Dictionary } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish, fp, bn } from '../../lib/helpers/numbers';
import { deployTokens, TokenList } from '../../lib/helpers/tokens';
import { MAX_UINT112, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { Comparison, expectBalanceChange } from '../helpers/tokenBalance';
import { FundManagement, Swap, toSwapIn, toSwapOut } from '../../lib/helpers/trading';
import { MinimalSwapInfoPool, PoolSpecializationSetting, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';
import { encodeJoin } from '../helpers/mockPool';

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
  let lp: SignerWithAddress, trader: SignerWithAddress, other: SignerWithAddress;

  before('setup', async () => {
    [, lp, trader, other] = await ethers.getSigners();

    // This suite contains a very large number of tests, so we don't redeploy all contracts for each single test. This
    // means tests are not fully independent, and may affect each other (e.g. if they use very large amounts of tokens,
    // or rely on internal balance).

    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    for (const symbol in tokens) {
      // lp tokens are used to seed pools
      await tokens[symbol].mint(lp.address, MAX_UINT112.div(2));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT112);

      await tokens[symbol].mint(trader.address, MAX_UINT112.div(2));
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT112);
    }
  });

  beforeEach('set up default sender', async () => {
    funds = {
      //sender: trader.address,
      recipient: trader.address,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  context('with two tokens', () => {
    const symbols = ['DAI', 'MKR'];

    context('with a general pool', () => {
      itHandlesSwapsProperly(GeneralPool, symbols);
    });

    context('with a minimal swap info pool', () => {
      itHandlesSwapsProperly(MinimalSwapInfoPool, symbols);
    });

    context('with a two token pool', () => {
      itHandlesSwapsProperly(TwoTokenPool, symbols);
    });
  });

  context('with three tokens', () => {
    const symbols = ['DAI', 'MKR', 'SNX'];

    context('with a general pool', () => {
      itHandlesSwapsProperly(GeneralPool, symbols);
    });

    context('with a minimal swap info pool', () => {
      itHandlesSwapsProperly(MinimalSwapInfoPool, symbols);
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

  async function deployPool(specialization: PoolSpecializationSetting, tokenSymbols: string[]): Promise<string> {
    const pool = await deploy('MockPool', { args: [vault.address, specialization] });
    await pool.setMultiplier(fp(2));

    // Register tokens
    const tokenAddresses = tokenSymbols
      .map((symbol) => tokens[symbol].address)
      .sort((tokenA, tokenB) => (tokenA.toLowerCase() > tokenB.toLowerCase() ? 1 : -1));

    const assetManagers = tokenAddresses.map(() => ZERO_ADDRESS);

    await pool.connect(lp).registerTokens(tokenAddresses, assetManagers);

    // Join the pool - the actual amount is not relevant since the MockPool relies on the multiplier to calculate prices
    const tokenAmounts = tokenAddresses.map(() => bn(100e18));

    const poolId = pool.getPoolId();
    await vault.connect(lp).joinPool(
      poolId,
      other.address,
      tokenAddresses,
      tokenAmounts,
      false,
      encodeJoin(
        tokenAmounts,
        tokenAddresses.map(() => 0)
      )
    );

    return poolId;
  }

  function deployMainPool(specialization: PoolSpecializationSetting, tokenSymbols: string[]) {
    beforeEach('deploy main pool', async () => {
      poolId = await deployPool(specialization, tokenSymbols);
      poolIds = [poolId];
    });
  }

  function deployAnotherPool(specialization: PoolSpecializationSetting, tokenSymbols: string[]) {
    beforeEach('deploy secondary pool', async () => {
      anotherPoolId = await deployPool(specialization, tokenSymbols);
      poolIds.push(anotherPoolId);
    });
  }

  function itHandlesSwapsProperly(specialization: PoolSpecializationSetting, tokenSymbols: string[]) {
    deployMainPool(specialization, tokenSymbols);

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
          context('when the given indexes are valid', () => {
            context('when the given token is in the pool', () => {
              context('when the requested token is in the pool', () => {
                context('when requesting another token', () => {
                  context('when requesting a reasonable amount', () => {
                    // Send 1 MKR, get 2 DAI back
                    const swaps = [{ in: 1, out: 0, amount: 1e18 }];

                    context('when using managed balance', () => {
                      assertSwapGivenIn({ swaps }, { DAI: 2e18, MKR: -1e18 });
                    });

                    context('when withdrawing from internal balance', () => {
                      context.skip('when using less than available as internal balance', () => {
                        // TODO: add tests where no token transfers are needed and internal balance remains
                      });

                      context('when using more than available as internal balance', () => {
                        beforeEach('deposit to internal balance', async () => {
                          funds.fromInternalBalance = true;
                          await vault
                            .connect(trader)
                            .depositToInternalBalance([tokens.MKR.address], [bn(0.3e18)], trader.address);
                        });

                        assertSwapGivenIn({ swaps }, { DAI: 2e18, MKR: -0.7e18 });
                      });
                    });

                    context('when depositing from internal balance', () => {
                      beforeEach('deposit to internal balance', async () => {
                        funds.toInternalBalance = true;
                      });

                      assertSwapGivenIn({ swaps }, { MKR: -1e18 });
                    });
                  });

                  context('when draining the pool', () => {
                    const swaps = [{ in: 1, out: 0, amount: 50e18 }];

                    assertSwapGivenIn({ swaps }, { DAI: 100e18, MKR: -50e18 });
                  });

                  context('when requesting more than the available balance', () => {
                    const swaps = [{ in: 1, out: 0, amount: 100e18 }];

                    assertSwapGivenInReverts({ swaps }, 'ERR_SUB_OVERFLOW');
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

          context('when the given indexes are not valid', () => {
            context('when the token index in is not valid', () => {
              const swaps = [{ in: 30, out: 1, amount: 1e18 }];

              assertSwapGivenInReverts({ swaps }, 'ERR_INDEX_OUT_OF_BOUNDS');
            });

            context('when the token index out is not valid', () => {
              const swaps = [{ in: 0, out: 10, amount: 1e18 }];

              assertSwapGivenInReverts({ swaps }, 'ERR_INDEX_OUT_OF_BOUNDS');
            });
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

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                    beforeEach('tweak the main pool to give back as much as it receives', async () => {
                      const [poolAddress] = (await vault.getPool(poolIds[0])) as [string, unknown];
                      const pool = await ethers.getContractAt('MockPool', poolAddress);
                      await pool.setMultiplier(fp(1));
                    });

                    beforeEach('tweak sender and recipient to be other address', async () => {
                      // The caller will receive profit in MKR, since it sold DAI for more MKR than it bought it for.
                      // The caller receives tokens and doesn't send any.
                      // Note the caller didn't even have any tokens to begin with.
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
                itHandleMultiSwapsWithoutHopsProperly(GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(MinimalSwapInfoPool);
              });

              context('with a two token pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                const anotherPoolSpecialization = GeneralPool;
                itHandleMultiSwapsWithoutHopsProperly(anotherPoolSpecialization);
              });

              context('with a minimal swap info pool', () => {
                const anotherPoolSpecialization = MinimalSwapInfoPool;
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

              assertSwapGivenInReverts({ swaps }, 'Misconstructed multihop swap');
            });
          });

          context('with another pool', () => {
            context('with two tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                itHandleMultiSwapsWithHopsProperly(GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(MinimalSwapInfoPool);
              });

              context('with a two token pool', () => {
                itHandleMultiSwapsWithHopsProperly(TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                itHandleMultiSwapsWithHopsProperly(GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(MinimalSwapInfoPool);
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
          context('when the given indexes are valid', () => {
            context('when the given token is in the pool', () => {
              context('when the requested token is in the pool', () => {
                context('when the requesting another token', () => {
                  context('when requesting a reasonable amount', () => {
                    // Get 1e18 DAI by sending 0.5e18 MKR
                    const swaps = [{ in: 1, out: 0, amount: 1e18 }];

                    context('when using managed balance', () => {
                      assertSwapGivenOut({ swaps }, { DAI: 1e18, MKR: -0.5e18 });
                    });

                    context('when withdrawing from internal balance', () => {
                      context.skip('when using less than available as internal balance', () => {
                        // TODO: add tests where no token transfers are needed and internal balance remains
                      });

                      context('when using more than available as internal balance', () => {
                        beforeEach('deposit to internal balance', async () => {
                          funds.fromInternalBalance = true;
                          await vault
                            .connect(trader)
                            .depositToInternalBalance([tokens.MKR.address], [bn(0.3e18)], trader.address);
                        });

                        assertSwapGivenOut({ swaps }, { DAI: 1e18, MKR: -0.2e18 });
                      });
                    });

                    context('when depositing from internal balance', () => {
                      beforeEach('deposit to internal balance', async () => {
                        funds.toInternalBalance = true;
                      });

                      assertSwapGivenOut({ swaps }, { MKR: -0.5e18 });
                    });
                  });

                  context('when draining the pool', () => {
                    const swaps = [{ in: 1, out: 0, amount: 100e18 }];

                    assertSwapGivenOut({ swaps }, { DAI: 100e18, MKR: -50e18 });
                  });

                  context('when requesting more than the available balance', () => {
                    const swaps = [{ in: 1, out: 0, amount: 200e18 }];

                    assertSwapGivenOutReverts({ swaps }, 'ERR_SUB_OVERFLOW');
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

          context('when the given indexes are not valid', () => {
            context('when the token index in is not valid', () => {
              const swaps = [{ in: 30, out: 1, amount: 1e18 }];

              assertSwapGivenOutReverts({ swaps }, 'ERR_INDEX_OUT_OF_BOUNDS');
            });

            context('when the token index out is not valid', () => {
              const swaps = [{ in: 0, out: 10, amount: 1e18 }];

              assertSwapGivenOutReverts({ swaps }, 'ERR_INDEX_OUT_OF_BOUNDS');
            });
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

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                      const [poolAddress] = (await vault.getPool(poolIds[0])) as [string, unknown];
                      const pool = await ethers.getContractAt('MockPool', poolAddress);
                      await pool.setMultiplier(fp(1));
                    });

                    beforeEach('tweak sender and recipient to be other address', async () => {
                      // The caller will receive profit in MKR, since it sold DAI for more MKR than it bought it for.
                      // The caller receives tokens and doesn't send any.
                      // Note the caller didn't even have any tokens to begin with.
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
                itHandleMultiSwapsWithoutHopsProperly(GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(MinimalSwapInfoPool);
              });
              context('with a two token pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithoutHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                itHandleMultiSwapsWithoutHopsProperly(GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithoutHopsProperly(MinimalSwapInfoPool);
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

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                itHandleMultiSwapsWithHopsProperly(GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(MinimalSwapInfoPool);
              });

              context('with a two token pool', () => {
                itHandleMultiSwapsWithHopsProperly(TwoTokenPool);
              });
            });

            context('with three tokens', () => {
              const anotherPoolSymbols = ['DAI', 'MKR', 'SNX'];

              const itHandleMultiSwapsWithHopsProperly = (anotherPoolSpecialization: PoolSpecializationSetting) => {
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
                itHandleMultiSwapsWithHopsProperly(GeneralPool);
              });

              context('with a minimal swap info pool', () => {
                itHandleMultiSwapsWithHopsProperly(MinimalSwapInfoPool);
              });
            });
          });
        });
      });
    });
  }
});
