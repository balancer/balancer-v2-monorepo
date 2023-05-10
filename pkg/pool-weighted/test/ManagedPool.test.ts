import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, ContractReceipt } from 'ethers';

import { BigNumberish, bn, fp, fpDiv, fpMul, FP_ONE, FP_ZERO, pct } from '@balancer-labs/v2-helpers/src/numbers';
import {
  DAY,
  advanceTime,
  receiptTimestamp,
  currentTimestamp,
  setNextBlockTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import ManagedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/ManagedPool';
import {
  ExitResult,
  JoinQueryResult,
  JoinResult,
  RawManagedPoolDeployment,
  SwapResult,
  ManagedPoolType,
} from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PoolSpecialization, SwapKind } from '@balancer-labs/balancer-js';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { random } from 'lodash';

describe('ManagedPool', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let admin: SignerWithAddress, owner: SignerWithAddress, other: SignerWithAddress;
  let pool: ManagedPool;
  let vault: Vault;

  const poolVersion = JSON.stringify({
    name: 'ManagedPool',
    version: '0',
    deployment: 'test-deployment',
  });

  // Asset Management operations
  const OP_KIND = { WITHDRAW: 0, DEPOSIT: 1, UPDATE: 2 };

  before('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  const MAX_TOKENS = 50;
  const TOKEN_COUNT = 40;

  const BPT_INDEX = 0;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.05);

  const poolWeights: BigNumber[] = Array(TOKEN_COUNT).fill(fp(1 / TOKEN_COUNT));
  const initialBalances = Array(TOKEN_COUNT).fill(fp(1000));

  sharedBeforeEach('deploy tokens and AUMProtocolFeeCollector', async () => {
    allTokens = await TokenList.create(MAX_TOKENS + 1, { sorted: true, varyDecimals: true });
    poolTokens = allTokens.subset(TOKEN_COUNT);
    await allTokens.mint({ to: [other, owner], amount: fp(2000) });

    vault = await Vault.create({ admin });
    await allTokens.approve({ from: other, to: vault });
    await allTokens.approve({ from: owner, to: vault });
  });

  async function deployPool(overrides: RawManagedPoolDeployment = {}): Promise<ManagedPool> {
    const params = {
      vault,
      tokens: poolTokens,
      weights: poolWeights,
      owner: owner.address,
      aumFeeId: ProtocolFee.AUM,
      poolType: ManagedPoolType.MOCK_MANAGED_POOL,
      poolVersion,
      ...overrides,
    };
    return ManagedPool.create(params);
  }

  async function getUnscaledBptPrice(tokenIndex: number): Promise<BigNumber> {
    const totalSupply = await pool.getActualSupply();

    return fpDiv(fpMul(totalSupply, poolWeights[tokenIndex]), initialBalances[tokenIndex]);
  }

  async function setCircuitBreaker(tokenIndex: number, isLowerBound: boolean): Promise<void> {
    const tokenBptPrice = await getUnscaledBptPrice(tokenIndex);
    const bptPrices = initialBalances.map((_, i) => (i == tokenIndex ? tokenBptPrice : bn(0)));
    const lowerBounds = Array(poolTokens.length).fill(bn(0));
    const upperBounds = Array(poolTokens.length).fill(bn(0));

    // Set the bound to 1 so that any trade will trigger it
    (isLowerBound ? lowerBounds : upperBounds)[tokenIndex] = FP_ONE;

    await pool.setCircuitBreakers(owner, poolTokens.tokens, bptPrices, lowerBounds, upperBounds);
  }

  describe('construction', () => {
    context('pool registration', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();
      });

      it('returns pool ID registered by the vault', async () => {
        const poolId = await pool.getPoolId();
        const { address: poolAddress } = await vault.getPool(poolId);
        expect(poolAddress).to.be.eq(pool.address);
      });

      it('registers with the MinimalSwapInfo specialization', async () => {
        const { specialization } = await vault.getPool(pool.poolId);
        expect(specialization).to.be.eq(PoolSpecialization.MinimalSwapInfoPool);
      });

      it('registers all the expected tokens', async () => {
        const { tokens } = await vault.getPoolTokens(pool.poolId);
        expect(tokens).to.be.deep.eq([pool.address, ...poolTokens.addresses]);
      });

      it('registers all the expected asset managers', async () => {
        await poolTokens.asyncEach(async (token) => {
          const { assetManager } = await vault.getPoolTokenInfo(pool.poolId, token);
          expect(assetManager).to.be.eq(ZERO_ADDRESS);
        });
      });

      it('returns the expected pool version', async () => {
        expect(await pool.version()).to.be.eq(poolVersion);
      });
    });
  });

  describe('swap', () => {
    sharedBeforeEach('deploy pool', async () => {
      pool = await deployPool({ swapEnabledOnStart: true });

      await pool.init({ from: other, initialBalances });
    });

    context('token swaps', () => {
      context('when swaps are disabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          await pool.setSwapEnabled(owner, false);
        });

        it('it reverts', async () => {
          await expect(
            pool.swapGivenIn({ in: 1, out: 2, amount: fp(0.1), from: other, recipient: other })
          ).to.be.revertedWith('SWAPS_DISABLED');
        });
      });

      context('when swaps are enabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          await pool.setSwapEnabled(owner, true);
        });

        it('swaps are not blocked', async () => {
          await expect(pool.swapGivenIn({ in: 1, out: 2, amount: fp(0.1), from: other, recipient: other })).to.not.be
            .reverted;
        });
      });

      context('circuit breakers', () => {
        let tokenInIndex: number;
        let tokenOutIndex: number;

        sharedBeforeEach('set token indices', async () => {
          // BPT_INDEX is always zero, so valid token indices will be 1 - numTokens
          tokenInIndex = random(poolTokens.length - 1);
          tokenOutIndex = tokenInIndex == poolTokens.length - 1 ? 0 : tokenInIndex + 1;
        });

        function itChecksCircuitBreakersOnRegularSwaps(
          isGivenIn: boolean,
          setCircuitBreaker: () => Promise<void>,
          doSwap: () => Promise<SwapResult>
        ) {
          it(`reverts on Given${isGivenIn ? 'In' : 'Out'}`, async () => {
            await setCircuitBreaker();
            await expect(doSwap()).to.be.revertedWith('CIRCUIT_BREAKER_TRIPPED');
          });
        }

        context('check lower bound', () => {
          itChecksCircuitBreakersOnRegularSwaps(
            true, // indicate GivenIn
            () => setCircuitBreaker(tokenInIndex, true),
            () =>
              pool.swapGivenIn({
                in: poolTokens.tokens[tokenInIndex],
                out: poolTokens.tokens[tokenOutIndex],
                amount: fp(0.1),
                from: other,
                recipient: other,
              })
          );

          itChecksCircuitBreakersOnRegularSwaps(
            false, // indicate GivenOut
            () => setCircuitBreaker(tokenInIndex, true),
            () =>
              pool.swapGivenOut({
                in: poolTokens.tokens[tokenInIndex],
                out: poolTokens.tokens[tokenOutIndex],
                amount: fp(0.1),
                from: other,
                recipient: other,
              })
          );
        });

        context('check upper bound', () => {
          itChecksCircuitBreakersOnRegularSwaps(
            true, // indicate GivenIn
            () => setCircuitBreaker(tokenOutIndex, false),
            () =>
              pool.swapGivenIn({
                in: poolTokens.tokens[tokenInIndex],
                out: poolTokens.tokens[tokenOutIndex],
                amount: fp(0.1),
                from: other,
                recipient: other,
              })
          );

          itChecksCircuitBreakersOnRegularSwaps(
            false, // indicate GivenOut
            () => setCircuitBreaker(tokenOutIndex, false),
            () =>
              pool.swapGivenOut({
                in: poolTokens.tokens[tokenInIndex],
                out: poolTokens.tokens[tokenOutIndex],
                amount: fp(0.1),
                from: other,
                recipient: other,
              })
          );
        });
      });
    });

    context('join swaps', () => {
      let tokenInIndex: number;

      sharedBeforeEach('set token index', async () => {
        // BPT_INDEX is always zero, so valid token indices will be 1 - numTokens
        tokenInIndex = random(poolTokens.length - 1);
      });

      function itPerformsAJoinSwapCorrectly(
        joinTokenIndex: number,
        doJoinSwap: () => Promise<SwapResult>,
        queryJoinSwap: () => Promise<BigNumber[]>,
        queryEquivalentJoin: () => Promise<JoinQueryResult>
      ) {
        function isEquivalentToARegularJoin() {
          it("doesn't revert", async () => {
            await expect(doJoinSwap()).to.not.be.reverted;
          });

          it('returns the same amount of BPT as the equivalent join', async () => {
            const joinSwapResult = await queryJoinSwap();
            const joinResult = await queryEquivalentJoin();

            // BPT is leaving the Vault and so is represented as a negative value.
            expect(joinSwapResult[BPT_INDEX].mul(-1)).to.be.eq(joinResult.bptOut);
          });

          it('takes the same amount of tokens as the equivalent join', async () => {
            const joinSwapResult = await queryJoinSwap();
            const joinResult = await queryEquivalentJoin();

            // Note that these two arrays index over two different sets of tokens.
            // `joinSwapResult` indexes over the tokens involved in the swap and so has length 2
            // `joinResult.amountsIn` indexes over all the tokens in the pool (including BPT).
            expect(joinSwapResult[1]).to.be.eq(joinResult.amountsIn[joinTokenIndex]);
          });
        }

        context('when swaps are disabled', () => {
          sharedBeforeEach('disable swaps', async () => {
            await pool.setSwapEnabled(owner, false);
          });

          it('it reverts', async () => {
            await expect(doJoinSwap()).to.be.revertedWith('SWAPS_DISABLED');
          });
        });

        context('when joins are disabled', () => {
          sharedBeforeEach('disable joins', async () => {
            await pool.setJoinExitEnabled(owner, false);
          });

          it('it reverts', async () => {
            await expect(doJoinSwap()).to.be.revertedWith('JOINS_EXITS_DISABLED');
          });
        });

        context('when swaps and joins are enabled', () => {
          sharedBeforeEach('enable joins and swaps', async () => {
            await pool.setSwapEnabled(owner, true);
            await pool.setJoinExitEnabled(owner, true);
          });

          context('when LP allowlist is enabled', () => {
            sharedBeforeEach('enable allowlist', async () => {
              await pool.setMustAllowlistLPs(owner, true);
            });

            context('when trader is allowlisted', () => {
              sharedBeforeEach('allowlist LP', async () => {
                await pool.addAllowedAddress(owner, other);
              });

              isEquivalentToARegularJoin();
            });

            context('when trader is not allowlisted', () => {
              it('reverts', async () => {
                await expect(doJoinSwap()).to.be.revertedWith('ADDRESS_NOT_ALLOWLISTED');
              });
            });
          });

          context('when LP allowlist is disabled', () => {
            sharedBeforeEach('disable allowlist', async () => {
              await pool.setMustAllowlistLPs(owner, false);
            });

            isEquivalentToARegularJoin();
          });
        });
      }

      function itChecksCircuitBreakersOnJoinSwaps(
        setCircuitBreaker: () => Promise<void>,
        doJoinSwap: () => Promise<SwapResult>
      ) {
        it('checks circuit breakers on joinSwap', async () => {
          await setCircuitBreaker();
          await expect(doJoinSwap()).to.be.revertedWith('CIRCUIT_BREAKER_TRIPPED');
        });
      }

      const JOIN_TOKEN_INDEX = 1;

      context('given in', () => {
        itPerformsAJoinSwapCorrectly(
          JOIN_TOKEN_INDEX,
          () =>
            pool.swapGivenIn({ in: JOIN_TOKEN_INDEX, out: BPT_INDEX, amount: fp(0.1), from: other, recipient: other }),
          () =>
            pool.vault.queryBatchSwap({
              kind: SwapKind.GivenIn,
              assets: [pool.address, poolTokens.first.address],
              funds: {
                sender: other.address,
                fromInternalBalance: false,
                recipient: other.address,
                toInternalBalance: false,
              },
              swaps: [{ poolId: pool.poolId, assetInIndex: 1, assetOutIndex: 0, amount: fp(0.1), userData: '0x' }],
            }),
          () =>
            pool.queryJoinGivenIn({
              // `amountsIn` and `poolTokens` don't include BPT so we subtract 1 from JOIN_TOKEN_INDEX
              amountsIn: poolTokens.map((_, i) => (i == JOIN_TOKEN_INDEX - 1 ? fp(0.1) : FP_ZERO)),
              from: other,
              recipient: other,
            })
        );

        itChecksCircuitBreakersOnJoinSwaps(
          () => setCircuitBreaker(tokenInIndex, true),
          () =>
            pool.swapGivenIn({
              in: poolTokens.tokens[tokenInIndex],
              out: BPT_INDEX,
              amount: fp(0.1),
              from: other,
              recipient: other,
            })
        );
      });

      context('given out', () => {
        itPerformsAJoinSwapCorrectly(
          JOIN_TOKEN_INDEX,
          () =>
            pool.swapGivenOut({ in: JOIN_TOKEN_INDEX, out: BPT_INDEX, amount: fp(0.1), from: other, recipient: other }),
          () =>
            pool.vault.queryBatchSwap({
              kind: SwapKind.GivenOut,
              assets: [pool.address, poolTokens.first.address],
              funds: {
                sender: other.address,
                fromInternalBalance: false,
                recipient: other.address,
                toInternalBalance: false,
              },
              swaps: [{ poolId: pool.poolId, assetInIndex: 1, assetOutIndex: 0, amount: fp(0.1), userData: '0x' }],
            }),
          () =>
            pool.queryJoinGivenOut({
              // `userData` doesn't account for BPT so we subtract 1 from JOIN_TOKEN_INDEX
              token: JOIN_TOKEN_INDEX - 1,
              bptOut: fp(0.1),
              from: other,
              recipient: other,
            })
        );

        // Need enough BPT to move the price (don't need much) - 0.01% of the holdings
        let bptOut: BigNumber;

        sharedBeforeEach('set BPT out amount', async () => {
          bptOut = pct(await pool.balanceOf(other), 0.0001);
        });

        itChecksCircuitBreakersOnJoinSwaps(
          () => setCircuitBreaker(tokenInIndex, true),
          () =>
            pool.swapGivenOut({
              in: poolTokens.tokens[tokenInIndex],
              out: BPT_INDEX,
              amount: bptOut,
              from: other,
              recipient: other,
            })
        );
      });
    });

    context('exit swaps', () => {
      let tokenOutIndex: number;

      sharedBeforeEach('set token index', async () => {
        // BPT_INDEX is always zero, so valid token indices will be 1 - numTokens
        tokenOutIndex = random(poolTokens.length - 1);
      });

      function itPerformsAnExitSwapCorrectly(
        exitTokenIndex: number,
        doExitSwap: () => Promise<SwapResult>,
        queryExitSwap: () => Promise<BigNumber[]>,
        queryEquivalentExit: () => Promise<ExitQueryResult>
      ) {
        function isEquivalentToARegularExit() {
          it("doesn't revert", async () => {
            await expect(doExitSwap()).to.not.be.reverted;
          });

          it('returns the same amount of BPT as the equivalent join', async () => {
            const joinSwapResult = await queryExitSwap();
            const joinResult = await queryEquivalentExit();

            expect(joinSwapResult[0]).to.be.eq(joinResult.bptIn);
          });

          it('takes the same amount of tokens as the equivalent join', async () => {
            const joinSwapResult = await queryExitSwap();
            const joinResult = await queryEquivalentExit();

            // Tokens are leaving the Vault and so is represented as a negative value.
            expect(joinSwapResult[1].mul(-1)).to.be.eq(joinResult.amountsOut[exitTokenIndex]);
          });
        }

        context('when swaps are disabled', () => {
          sharedBeforeEach('disable swaps', async () => {
            await pool.setSwapEnabled(owner, false);
          });

          it('it reverts', async () => {
            await expect(doExitSwap()).to.be.revertedWith('SWAPS_DISABLED');
          });
        });

        context('when exits are disabled', () => {
          sharedBeforeEach('disable exits', async () => {
            await pool.setJoinExitEnabled(owner, false);
          });

          it('it reverts', async () => {
            await expect(doExitSwap()).to.be.revertedWith('JOINS_EXITS_DISABLED');
          });
        });

        context('when swaps and exits are enabled', () => {
          sharedBeforeEach('enable swaps and exits', async () => {
            await pool.setSwapEnabled(owner, true);
            await pool.setJoinExitEnabled(owner, true);
          });

          context('when LP allowlist is enabled', () => {
            sharedBeforeEach('enable allowlist', async () => {
              await pool.setMustAllowlistLPs(owner, true);
            });

            context('when trader is allowlisted', () => {
              sharedBeforeEach('allowlist LP', async () => {
                await pool.addAllowedAddress(owner, other);
              });

              isEquivalentToARegularExit();
            });

            context('when trader is not allowlisted', () => {
              // The allowlist is for joins, not exits or swaps
              isEquivalentToARegularExit();
            });
          });

          context('when LP allowlist is disabled', () => {
            sharedBeforeEach('disable allowlist', async () => {
              await pool.setMustAllowlistLPs(owner, false);
            });

            isEquivalentToARegularExit();
          });
        });
      }

      function itChecksCircuitBreakersOnExitSwaps(
        setCircuitBreaker: () => Promise<void>,
        doExitSwap: () => Promise<SwapResult>
      ) {
        it('checks circuit breakers on exitSwap', async () => {
          await setCircuitBreaker();
          await expect(doExitSwap()).to.be.revertedWith('CIRCUIT_BREAKER_TRIPPED');
        });
      }

      const EXIT_TOKEN_INDEX = 1;

      context('given in', () => {
        itPerformsAnExitSwapCorrectly(
          EXIT_TOKEN_INDEX,
          () =>
            pool.swapGivenIn({ in: BPT_INDEX, out: EXIT_TOKEN_INDEX, amount: fp(0.1), from: other, recipient: other }),
          () =>
            pool.vault.queryBatchSwap({
              kind: SwapKind.GivenIn,
              assets: [pool.address, poolTokens.first.address],
              funds: {
                sender: other.address,
                fromInternalBalance: false,
                recipient: other.address,
                toInternalBalance: false,
              },
              swaps: [{ poolId: pool.poolId, assetInIndex: 0, assetOutIndex: 1, amount: fp(0.1), userData: '0x' }],
            }),
          () =>
            pool.querySingleExitGivenIn({
              bptIn: fp(0.1),
              token: EXIT_TOKEN_INDEX - 1,
              from: other,
              recipient: other,
            })
        );

        itChecksCircuitBreakersOnExitSwaps(
          () => setCircuitBreaker(tokenOutIndex, false),
          () =>
            pool.swapGivenIn({
              in: BPT_INDEX,
              out: poolTokens.tokens[tokenOutIndex],
              amount: fp(0.1),
              from: other,
              recipient: other,
            })
        );
      });

      context('given out', () => {
        itPerformsAnExitSwapCorrectly(
          EXIT_TOKEN_INDEX,
          () =>
            pool.swapGivenOut({ in: BPT_INDEX, out: EXIT_TOKEN_INDEX, amount: fp(0.1), from: other, recipient: other }),
          () =>
            pool.vault.queryBatchSwap({
              kind: SwapKind.GivenOut,
              assets: [pool.address, poolTokens.first.address],
              funds: {
                sender: other.address,
                fromInternalBalance: false,
                recipient: other.address,
                toInternalBalance: false,
              },
              swaps: [{ poolId: pool.poolId, assetInIndex: 0, assetOutIndex: 1, amount: fp(0.1), userData: '0x' }],
            }),
          () =>
            pool.queryExitGivenOut({
              // `amountsIn` and `poolTokens` don't include BPT so we subtract 1 from JOIN_TOKEN_INDEX
              amountsOut: poolTokens.map((_, i) => (i == EXIT_TOKEN_INDEX - 1 ? fp(0.1) : FP_ZERO)),
              from: other,
              recipient: other,
            })
        );

        itChecksCircuitBreakersOnExitSwaps(
          () => setCircuitBreaker(tokenOutIndex, false),
          () =>
            pool.swapGivenOut({
              in: BPT_INDEX,
              out: poolTokens.tokens[tokenOutIndex],
              amount: fp(0.1),
              from: other,
              recipient: other,
            })
        );
      });
    });
  });

  describe('initialization', () => {
    function itInitializesThePoolCorrectly() {
      it('initializes the pool', async () => {
        await pool.init({ from: other, initialBalances });

        expect(await pool.totalSupply()).to.be.gt(0);
      });

      it('sets the first AUM fee collection timestamp', async () => {
        const { receipt } = await pool.init({ from: other, initialBalances });

        const [, lastAUMFeeCollectionTimestamp] = await pool.getManagementAumFeeParams();
        expect(lastAUMFeeCollectionTimestamp).to.be.eq(await receiptTimestamp(receipt));
      });
    }

    context('LP allowlist', () => {
      context('when LP allowlist is enabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          pool = await deployPool({ mustAllowlistLPs: true });
        });

        context('when initial LP is allowlisted', () => {
          sharedBeforeEach('allowlist LP', async () => {
            await pool.addAllowedAddress(owner, other);
          });

          itInitializesThePoolCorrectly();
        });

        context('when initial LP is not allowlisted', () => {
          it('reverts', async () => {
            await expect(pool.init({ from: other, initialBalances })).to.be.revertedWith('ADDRESS_NOT_ALLOWLISTED');
          });
        });
      });

      context('when LP allowlist is disabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          pool = await deployPool({ mustAllowlistLPs: false });
        });
        itInitializesThePoolCorrectly();
      });
    });
  });

  describe('joinPool', () => {
    context('when LP allowlist is enabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();
        await pool.init({ from: other, initialBalances });

        await pool.setMustAllowlistLPs(owner, true);
      });

      context('when LP is on the allowlist', () => {
        sharedBeforeEach('add address to allowlist', async () => {
          await pool.addAllowedAddress(owner, other.address);
        });

        it('the listed LP can join', async () => {
          await pool.joinAllGivenOut({ from: other, bptOut: FP_ONE });

          expect(await pool.balanceOf(other)).to.be.gt(0);
        });
      });

      context('when LP is not on the allowlist', () => {
        it('it reverts', async () => {
          await expect(pool.joinAllGivenOut({ from: other, bptOut: FP_ONE })).to.be.revertedWith(
            'ADDRESS_NOT_ALLOWLISTED'
          );
        });
      });
    });

    context('when swaps are disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool({ swapEnabledOnStart: false });
        await pool.init({ from: other, initialBalances });
      });

      context('proportional joins', () => {
        it('allows proportionate joins', async () => {
          const startingBpt = await pool.balanceOf(other);

          const { amountsIn } = await pool.joinAllGivenOut({ from: other, bptOut: startingBpt });

          const endingBpt = await pool.balanceOf(other);
          expect(endingBpt).to.be.gt(startingBpt);
          expect(amountsIn).to.deep.equal([FP_ZERO, ...initialBalances]);
        });
      });

      context('disproportionate joins', () => {
        it('prevents disproportionate joins (single token)', async () => {
          const bptOut = await pool.balanceOf(other);

          await expect(pool.joinGivenOut({ from: other, bptOut, token: poolTokens.get(0) })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });

        it('prevents disproportionate joins (multi token)', async () => {
          const amountsIn = [...initialBalances];
          amountsIn[0] = 0;

          await expect(pool.joinGivenIn({ from: other, amountsIn })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });
      });
    });

    context('when joins are disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool({ swapEnabledOnStart: true });
        await pool.init({ from: other, initialBalances });
        await pool.setJoinExitEnabled(owner, false);
      });

      context('proportional joins', () => {
        it('prevents proportionate joins', async () => {
          const startingBpt = await pool.balanceOf(other);

          await expect(pool.joinAllGivenOut({ from: other, bptOut: startingBpt })).to.be.revertedWith(
            'JOINS_EXITS_DISABLED'
          );
        });
      });

      context('disproportionate joins', () => {
        it('prevents disproportionate joins (single token)', async () => {
          const bptOut = await pool.balanceOf(other);

          await expect(pool.joinGivenOut({ from: other, bptOut, token: poolTokens.get(0) })).to.be.revertedWith(
            'JOINS_EXITS_DISABLED'
          );
        });

        it('prevents disproportionate joins (multi token)', async () => {
          const amountsIn = [...initialBalances];
          amountsIn[0] = 0;

          await expect(pool.joinGivenIn({ from: other, amountsIn })).to.be.revertedWith('JOINS_EXITS_DISABLED');
        });
      });
    });

    context('circuit breakers', () => {
      let tokenInIndex: number;
      let amountsIn: BigNumber[];

      function itChecksCircuitBreakersOnJoins(
        setCircuitBreaker: () => Promise<void>,
        doJoin: () => Promise<JoinResult>
      ) {
        it('checks circuit breakers on join', async () => {
          await setCircuitBreaker();
          await expect(doJoin()).to.be.revertedWith('CIRCUIT_BREAKER_TRIPPED');
        });
      }

      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();

        await pool.init({ from: other, initialBalances });
      });

      sharedBeforeEach('set token index', async () => {
        // BPT_INDEX is always zero, so valid token indices will be 1 - numTokens
        tokenInIndex = random(poolTokens.length - 1);
        amountsIn = Array(poolTokens.length).fill(0);
        amountsIn[tokenInIndex] = fp(0.1);
      });

      context('given in', () => {
        itChecksCircuitBreakersOnJoins(
          () => setCircuitBreaker(tokenInIndex, true),
          () => pool.joinGivenIn({ from: other, amountsIn })
        );
      });

      // Need enough BPT to move the price (don't need much) - 0.01% of the holdings
      let bptOut: BigNumber;

      sharedBeforeEach('set BPT out amount', async () => {
        bptOut = pct(await pool.balanceOf(other), 0.0001);
      });

      context('given out', () => {
        itChecksCircuitBreakersOnJoins(
          () => setCircuitBreaker(tokenInIndex, true),
          () => pool.joinGivenOut({ from: other, bptOut, token: poolTokens.tokens[tokenInIndex] })
        );
      });
    });
  });

  describe('exitPool', () => {
    context('when LP allowlist is enabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();
        await pool.init({ from: other, initialBalances });

        await pool.setMustAllowlistLPs(owner, true);
      });

      context('when LP is on the allowlist', () => {
        sharedBeforeEach('add address to allowlist', async () => {
          await pool.addAllowedAddress(owner, other.address);
        });

        it('the listed LP can exit', async () => {
          await expect(pool.multiExitGivenIn({ from: other, bptIn: FP_ONE })).to.not.be.reverted;
        });
      });

      context('when LP is not on the allowlist', () => {
        it('the listed LP can exit', async () => {
          await expect(pool.multiExitGivenIn({ from: other, bptIn: FP_ONE })).to.not.be.reverted;
        });
      });
    });

    context('when swaps are disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool({
          swapEnabledOnStart: false,
        });
        await pool.init({ from: other, initialBalances });
      });

      context('proportional exits', () => {
        it('allows proportional exits', async () => {
          const previousBptBalance = await pool.balanceOf(other);
          const bptIn = pct(previousBptBalance, 0.8);

          await expect(pool.multiExitGivenIn({ from: other, bptIn })).to.not.be.reverted;

          const newBptBalance = await pool.balanceOf(other);
          expect(newBptBalance).to.equalWithError(pct(previousBptBalance, 0.2), 0.001);
        });
      });

      context('disproportionate exits', () => {
        it('prevents disproportionate exits (single token)', async () => {
          const previousBptBalance = await pool.balanceOf(other);
          const bptIn = pct(previousBptBalance, 0.5);

          await expect(pool.singleExitGivenIn({ from: other, bptIn, token: poolTokens.get(0) })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });

        it('prevents disproportionate exits (multi token)', async () => {
          const amountsOut = [...initialBalances];
          // Make it disproportionate (though it will fail with this exit type even if it's technically proportionate)
          amountsOut[0] = 0;

          await expect(pool.exitGivenOut({ from: other, amountsOut })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });
      });
    });

    context('when exits are disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool({ swapEnabledOnStart: true });
        await pool.init({ from: other, initialBalances });
        await pool.setJoinExitEnabled(owner, false);
      });

      context('proportional exits', () => {
        it('prevents proportionate exits', async () => {
          const previousBptBalance = await pool.balanceOf(other);
          const bptIn = pct(previousBptBalance, 0.8);

          await expect(pool.multiExitGivenIn({ from: other, bptIn })).to.be.revertedWith('JOINS_EXITS_DISABLED');
        });
      });

      context('disproportionate exits', () => {
        it('prevents disproportionate exits (single token)', async () => {
          const previousBptBalance = await pool.balanceOf(other);
          const bptIn = pct(previousBptBalance, 0.5);

          await expect(pool.singleExitGivenIn({ from: other, bptIn, token: poolTokens.get(0) })).to.be.revertedWith(
            'JOINS_EXITS_DISABLED'
          );
        });

        it('prevents disproportionate exits (multi token)', async () => {
          const amountsOut = [...initialBalances];
          amountsOut[0] = 0;

          await expect(pool.exitGivenOut({ from: other, amountsOut })).to.be.revertedWith('JOINS_EXITS_DISABLED');
        });
      });
    });

    context('circuit breakers', () => {
      let tokenOutIndex: number;
      let amountsOut: BigNumber[];

      function itChecksCircuitBreakersOnExits(
        setCircuitBreaker: () => Promise<void>,
        doExit: () => Promise<ExitResult>
      ) {
        it('checks circuit breakers on exit', async () => {
          await setCircuitBreaker();
          await expect(doExit()).to.be.revertedWith('CIRCUIT_BREAKER_TRIPPED');
        });
      }

      function itDoesNotCheckCircuitBreakersOnProportionalExits(
        setCircuitBreaker: () => Promise<void>,
        doExit: () => Promise<ExitResult>
      ) {
        it('does not check circuit breakers on exit', async () => {
          await setCircuitBreaker();
          await expect(doExit()).to.not.be.reverted;
        });
      }

      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();

        await pool.init({ from: other, initialBalances });
      });

      sharedBeforeEach('set token index', async () => {
        // BPT_INDEX is always zero, so valid token indices will be 1 - numTokens
        tokenOutIndex = random(poolTokens.length - 1);
        amountsOut = Array(poolTokens.length).fill(0);
        amountsOut[tokenOutIndex] = fp(0.1);
      });

      // Need enough BPT to move the price (don't need much) - 0.01% of the holdings
      let bptIn: BigNumber;

      sharedBeforeEach('set BPT out amount', async () => {
        bptIn = pct(await pool.balanceOf(other), 0.0001);
      });

      context('given in (proportional)', () => {
        itDoesNotCheckCircuitBreakersOnProportionalExits(
          () => setCircuitBreaker(tokenOutIndex, false),
          () => pool.multiExitGivenIn({ from: other, bptIn })
        );
      });

      context('given in (non-proportional)', () => {
        itChecksCircuitBreakersOnExits(
          () => setCircuitBreaker(tokenOutIndex, false),
          () => pool.singleExitGivenIn({ from: other, bptIn, token: poolTokens.get(tokenOutIndex) })
        );
      });

      context('given out', () => {
        itChecksCircuitBreakersOnExits(
          () => setCircuitBreaker(tokenOutIndex, false),
          () => pool.exitGivenOut({ from: other, amountsOut })
        );
      });
    });
  });

  context('recovery mode', () => {
    sharedBeforeEach('deploy pool and enter recovery mode', async () => {
      pool = await deployPool({ assetManagers: Array(initialBalances.length).fill(other.address) });
      await pool.init({ from: other, initialBalances });
      await pool.enableRecoveryMode();
    });

    it('has expected asset managers', async () => {
      await poolTokens.asyncEach(async (token) => {
        const { assetManager } = await vault.getPoolTokenInfo(pool.poolId, token);
        expect(assetManager).to.be.eq(other.address);
      });
    });

    function itExitsViaRecoveryModeCorrectly() {
      it('the recovery mode exit can be used', async () => {
        const preExitBPT = await pool.balanceOf(other.address);
        const exitBPT = preExitBPT.div(3);

        // The sole BPT holder is the initial LP, so they own the initial balances
        const expectedChanges = poolTokens.reduce(
          (changes, token, i) => ({ ...changes, [token.symbol]: ['very-near', initialBalances[i].div(3)] }),
          {}
        );

        await expectBalanceChange(
          () =>
            pool.recoveryModeExit({
              from: other,
              bptIn: exitBPT,
            }),
          poolTokens,
          { account: other, changes: expectedChanges }
        );

        // Exit BPT was burned
        const afterExitBalance = await pool.balanceOf(other.address);
        expect(afterExitBalance).to.equal(preExitBPT.sub(exitBPT));
      });
    }

    itExitsViaRecoveryModeCorrectly();

    context('when paused', () => {
      sharedBeforeEach('pause pool', async () => {
        await pool.pause();
      });

      itExitsViaRecoveryModeCorrectly();
    });

    context('when exits are disabled', () => {
      sharedBeforeEach(async () => {
        await pool.setJoinExitEnabled(owner, false);
      });

      itExitsViaRecoveryModeCorrectly();
    });

    context('when there is a managed balance', () => {
      const doubleBalance = initialBalances[0].mul(2);

      sharedBeforeEach(async () => {
        // Add managed balance equal to the current balance of the first token, effectively doubling it
        const ops = [
          { poolId: pool.poolId, kind: OP_KIND.UPDATE, amount: initialBalances[0], token: poolTokens.first.address },
        ];

        await pool.vault.instance.connect(other).managePoolBalance(ops);
      });

      it('reflects the increased balance', async () => {
        const { balances } = await vault.getPoolTokens(pool.poolId);

        // Vault balances include the BPT at index 0, so the "first" token is at 1
        // Its balance should be doubled, while the next token should be unchanged
        expect(balances[1]).to.eq(doubleBalance);
        expect(balances[2]).to.eq(initialBalances[1]);
      });

      // Should ignore the managed balance, and exit with the cash tokens only
      itExitsViaRecoveryModeCorrectly();
    });
  });

  describe('update swap fee', () => {
    const MAX_SWAP_FEE_PERCENTAGE = fp(0.8);

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployPool({
        swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
      });
      await pool.init({ from: owner, initialBalances });
    });

    /* Test that would cause joinSwap to fail at 100% fee, if allowed:

    context('with a 100% swap fee', () => {
      sharedBeforeEach('set swap fee to 100%', async () => {
        const blockTimestamp = (await currentTimestamp()).add(1);
        await setNextBlockTimestamp(blockTimestamp);
        await pool.updateSwapFeeGradually(owner, blockTimestamp, blockTimestamp, fp(1), fp(1));
      });

      it('reverts on joinSwap', async () => {
        await expect(pool.joinGivenOut({ recipient: owner, bptOut: fp(1), token: 0 })).to.be.revertedWith('ZERO_DIVISION');
      });
    });*/

    context('with the max swap fee', () => {
      sharedBeforeEach('set swap fee to the max value (< 100%)', async () => {
        // In practice, a separate contract would call `updateSwapFeeGradually` using `block.timestamp` both as start
        // and endTime to make the change immediately.
        const nextBlockTimestamp = (await currentTimestamp()).add(1);
        await setNextBlockTimestamp(nextBlockTimestamp);
        await pool.updateSwapFeeGradually(
          owner,
          nextBlockTimestamp,
          nextBlockTimestamp,
          MAX_SWAP_FEE_PERCENTAGE,
          MAX_SWAP_FEE_PERCENTAGE
        );
      });

      it('allows (unfavorable) joinSwap', async () => {
        await expect(pool.joinGivenOut({ from: other, recipient: owner, bptOut: fp(1), token: 0 })).to.not.be.reverted;
      });
    });
  });

  describe('management fees', () => {
    const swapFeePercentage = fp(0.02);
    const managementAumFeePercentage = fp(0.1);

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployPool({ swapFeePercentage, managementAumFeePercentage });
    });

    describe('management aum fee collection', () => {
      function expectedAUMFees(
        virtualSupply: BigNumberish,
        aumFeePercentage: BigNumberish,
        timeElapsed: BigNumberish
      ): BigNumber {
        return bn(virtualSupply)
          .mul(timeElapsed)
          .div(365 * DAY)
          .mul(aumFeePercentage)
          .div(fp(1).sub(aumFeePercentage));
      }

      function itReverts(collectAUMFees: () => Promise<ContractReceipt>) {
        it('reverts', async () => {
          await expect(collectAUMFees()).to.be.revertedWith('PAUSED');
        });
      }

      function itCollectsNoAUMFees(collectAUMFees: () => Promise<ContractReceipt>) {
        it('collects no AUM fees', async () => {
          const balanceBefore = await pool.balanceOf(owner);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          expect(balanceAfter).to.equal(balanceBefore);

          expectEvent.notEmitted(receipt, 'ManagementAumFeeCollected');
        });
      }

      function itCollectsAUMFeesForExpectedDuration(
        collectAUMFees: () => Promise<ContractReceipt>,
        timeElapsed: BigNumberish
      ) {
        it('collects the expected amount of fees', async () => {
          const balanceBefore = await pool.balanceOf(owner);

          const virtualSupply = await pool.getVirtualSupply();
          const expectedManagementFeeBpt = expectedAUMFees(virtualSupply, managementAumFeePercentage, timeElapsed);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          const actualManagementFeeBpt = balanceAfter.sub(balanceBefore);
          expect(actualManagementFeeBpt).to.equalWithError(expectedManagementFeeBpt, 0.0001);

          expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'ManagementAumFeeCollected', {
            bptAmount: actualManagementFeeBpt,
          });
        });

        it('reports the expected actual supply', async () => {
          // As we're performing a join or exit here we need to account for the change in the BPT virtual supply due to
          // the join/exit. We do this by tracking the user's balance.
          const balanceBefore = await pool.balanceOf(other);
          const virtualSupplyBefore = await pool.getVirtualSupply();
          const expectedManagementFeeBpt = expectedAUMFees(
            virtualSupplyBefore,
            managementAumFeePercentage,
            timeElapsed
          );

          const balanceAfter = await pool.balanceOf(other);
          const joinExitDelta = balanceAfter.sub(balanceBefore);

          const expectedActualSupply = virtualSupplyBefore.add(expectedManagementFeeBpt).add(joinExitDelta);
          const actualSupply = await pool.getActualSupply();
          expect(actualSupply).to.be.equalWithError(expectedActualSupply, 1e-6);
        });

        it('does not affect the actual supply', async () => {
          // As we're performing a join or exit here we need to account for the change in the BPT virtual supply due to
          // the join/exit. We do this by tracking the user's balance.
          const balanceBefore = await pool.balanceOf(other);
          const actualSupplyBefore = await pool.getActualSupply();

          await collectAUMFees();

          const balanceAfter = await pool.balanceOf(other);
          const joinExitDelta = balanceAfter.sub(balanceBefore);

          const actualSupplyAfter = await pool.getActualSupply();
          expect(actualSupplyAfter).to.be.equalWithError(actualSupplyBefore.add(joinExitDelta), 1e-5);
        });

        it('syncs the total supply to the actual supply', async () => {
          // As we're performing a join or exit here we need to account for the change in the BPT virtual supply due to
          // the join/exit. We do this by tracking the user's balance.
          const balanceBefore = await pool.balanceOf(other);
          const actualSupplyBefore = await pool.getActualSupply();

          await collectAUMFees();

          const balanceAfter = await pool.balanceOf(other);
          const joinExitDelta = balanceAfter.sub(balanceBefore);

          const virtualSupplyAfter = await pool.getVirtualSupply();
          expect(virtualSupplyAfter).to.equalWithError(actualSupplyBefore.add(joinExitDelta), 1e-5);
        });
      }

      function itCollectsAUMFeesCorrectly(collectAUMFees: () => Promise<ContractReceipt>) {
        const timeElapsed = 10 * DAY;

        sharedBeforeEach('advance time', async () => {
          await advanceTime(timeElapsed);
        });

        itCollectsAUMFeesForExpectedDuration(collectAUMFees, timeElapsed);

        context('when the pool is paused and enters into recovery mode', () => {
          sharedBeforeEach('pause pool and enter recovery mode', async () => {
            await pool.pause();
            await pool.enableRecoveryMode();
          });

          itReverts(collectAUMFees);

          context('when the pool is then unpaused and removed from recovery mode', () => {
            sharedBeforeEach('unpause pool and exit recovery mode', async () => {
              // Exiting recovery mode will update the timestamp of the last collection.
              // This avoids the pool overcharging AUM fees after the unpause.
              await pool.unpause();
              await pool.disableRecoveryMode();

              // We now advance time so that we can test that the collected fees correspond to `timeElapsed`,
              // rather than `2 * timeElapsed` as we'd expect if the pool didn't correctly update while paused.
              await advanceTime(timeElapsed);
            });

            itCollectsAUMFeesForExpectedDuration(collectAUMFees, timeElapsed);
          });
        });
      }

      sharedBeforeEach('mint tokens', async () => {
        await poolTokens.mint({ to: other, amount: fp(10000) });
        await poolTokens.approve({ from: other, to: await pool.getVault() });
      });

      context('on pool joins', () => {
        context('on pool initialization', () => {
          itCollectsNoAUMFees(async () => {
            const { receipt } = await pool.init({ from: other, recipient: other, initialBalances });
            return receipt;
          });
        });

        context('after pool initialization', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          itCollectsAUMFeesCorrectly(async () => {
            const { receipt } = await pool.joinAllGivenOut({ from: other, bptOut: FP_ONE });
            return receipt;
          });
        });
      });

      context('on joinSwaps', () => {
        context('after pool initialization', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          context('given in', () => {
            itCollectsAUMFeesCorrectly(async () => {
              const { receipt } = await pool.swapGivenIn({
                in: 1,
                out: BPT_INDEX,
                from: other,
                recipient: other,
                amount: FP_ONE,
              });
              return receipt;
            });
          });

          context('given out', () => {
            itCollectsAUMFeesCorrectly(async () => {
              const { receipt } = await pool.swapGivenOut({
                in: 1,
                out: BPT_INDEX,
                from: other,
                recipient: other,
                amount: FP_ONE,
              });
              return receipt;
            });
          });
        });
      });

      context('on exitSwaps', () => {
        context('after pool initialization', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          context('given in', () => {
            itCollectsAUMFeesCorrectly(async () => {
              const { receipt } = await pool.swapGivenIn({
                in: BPT_INDEX,
                out: 1,
                from: other,
                recipient: other,
                amount: FP_ONE,
              });
              return receipt;
            });
          });

          context('given out', () => {
            itCollectsAUMFeesCorrectly(async () => {
              const { receipt } = await pool.swapGivenOut({
                in: BPT_INDEX,
                out: 1,
                from: other,
                recipient: other,
                amount: FP_ONE,
              });
              return receipt;
            });
          });
        });
      });

      context('on pool exits', () => {
        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ from: other, initialBalances });
        });

        itCollectsAUMFeesCorrectly(async () => {
          const { receipt } = await pool.multiExitGivenIn({ from: other, bptIn: await pool.balanceOf(other) });
          return receipt;
        });
      });
    });
  });
});
