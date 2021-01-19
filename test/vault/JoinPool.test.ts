import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { deployTokens, mintTokens, TokenList } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../helpers/constants';
import { PoolOptimizationSetting, SimplifiedQuotePool, StandardPool, TwoTokenPool } from '../../scripts/helpers/pools';
import { expectBalanceChange } from '../helpers/tokenBalance';

let admin: SignerWithAddress;
let lp: SignerWithAddress;
let other: SignerWithAddress;

let authorizer: Contract;
let vault: Contract;
let symbols: string[];
let tokens: TokenList = {};
let tokenAddresses: string[];

describe('Vault - join pool', () => {
  before(async () => {
    [, admin, lp, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    symbols = ['DAI', 'MKR', 'SNX'];
    tokens = await deployTokens(symbols, [18, 18, 18]);

    for (const symbol in tokens) {
      // Mint tokens for the lp to deposit in the Vault
      await mintTokens(tokens, symbol, lp, (100e18).toString());
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);
    }

    tokenAddresses = [];
    for (const symbol in tokens) {
      tokenAddresses.push(tokens[symbol].address);
    }
  });

  describe('with standard pool', () => {
    itJoinsPoolCorrectly(StandardPool, 3);
  });

  describe('with simplified quote pool', () => {
    itJoinsPoolCorrectly(SimplifiedQuotePool, 3);
  });

  describe('with two token pool', () => {
    itJoinsPoolCorrectly(TwoTokenPool, 2);
  });

  function itJoinsPoolCorrectly(optimization: PoolOptimizationSetting, tokenAmount: number) {
    let pool: Contract;
    let poolId: string;

    beforeEach(async () => {
      pool = await deploy('MockPool', { args: [vault.address, optimization] });
      poolId = await pool.getPoolId();

      tokenAddresses = tokenAddresses.slice(0, tokenAmount).sort();

      await pool.registerTokens(tokenAddresses);
    });

    let joinAmounts: BigNumber[];
    let dueProtocolFeeAmounts: BigNumber[];

    let maxAmountsIn: BigNumber[];
    let withdrawFromInternalBalance: boolean;

    function callJoinPool() {
      return vault
        .connect(lp)
        .joinPool(poolId, other.address, tokenAddresses, maxAmountsIn, withdrawFromInternalBalance, '0x');
    }

    describe('joinPool', () => {
      function symbol(tokenAddress: string): string {
        for (const symbol in tokens) {
          if (tokens[symbol].address === tokenAddress) {
            return symbol;
          }
        }

        throw new Error(`Symbol for token ${tokenAddresses} not found`);
      }

      async function assertJoinBalanceChanges(expectedLPDeltas: BigNumberish[], expectedPoolDeltas: BigNumberish[]) {
        const prePoolBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);
        const preCollectedFees = await Promise.all(tokenAddresses.map((token) => vault.getCollectedFeesByToken(token)));

        const changes = Object.assign(
          {},
          ...expectedLPDeltas.map((delta, i) => {
            return { [symbol(tokenAddresses[i])]: delta };
          })
        );
        await expectBalanceChange(callJoinPool, tokens, { account: lp, changes });

        const postPoolBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);
        const postCollectedFees = await Promise.all(
          tokenAddresses.map((token) => vault.getCollectedFeesByToken(token))
        );

        const poolDeltas = [];
        for (let i = 0; i < tokenAmount; ++i) {
          poolDeltas.push(postPoolBalances[i].sub(prePoolBalances[i]));
        }

        const collectedFeeDeltas = [];
        for (let i = 0; i < tokenAmount; ++i) {
          collectedFeeDeltas.push(postCollectedFees[i].sub(preCollectedFees[i]));
        }

        expect(poolDeltas).to.deep.equal(expectedPoolDeltas.map((delta) => BigNumber.from(delta.toString())));
        expect(collectedFeeDeltas).to.deep.equal(
          dueProtocolFeeAmounts.map((amount) => BigNumber.from(amount.toString()))
        );
      }

      context('with no due protocol fees', () => {
        beforeEach(async () => {
          dueProtocolFeeAmounts = Array(tokenAddresses.length).fill(0);
        });

        context('with sufficient maximum amounts in', () => {
          beforeEach(async () => {
            maxAmountsIn = Array(tokenAddresses.length).fill(MAX_UINT256);
          });

          context('without withdrawing from internal balance', () => {
            beforeEach(async () => {
              withdrawFromInternalBalance = false;
            });

            it('allows zero-token joins', async () => {
              joinAmounts = Array(tokenAddresses.length).fill(0);
              await pool.setOnJoinPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);

              await assertJoinBalanceChanges(Array(tokenAmount).fill(0), Array(tokenAmount).fill(0));
            });

            context('with non-zero join amounts', () => {
              beforeEach(async () => {
                joinAmounts = [];
                for (let i = 0; i < tokenAmount; ++i) {
                  joinAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
                }

                await pool.setOnJoinPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
              });

              it('allocates tokens to the pool', async () => {
                await assertJoinBalanceChanges(
                  joinAmounts.map((amount) => amount.mul(-1)),
                  joinAmounts
                );
              });
            });
          });

          context('withdrawing from internal balance', () => {
            beforeEach(async () => {
              withdrawFromInternalBalance = true;

              // No point in testing zero join amounts here
              joinAmounts = [];
              for (let i = 0; i < tokenAmount; ++i) {
                joinAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
              }

              await pool.setOnJoinPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
            });

            it('transfers all tokens if internal balance is zero', async () => {
              await assertJoinBalanceChanges(
                joinAmounts.map((amount) => amount.mul(-1)),
                joinAmounts
              );
            });

            it('uses both token transfers and internal balance if it is not enough', async () => {
              // Deposit the required amount, minus one
              await vault.connect(lp).deposit(tokenAddresses[1], joinAmounts[1].sub(1), lp.address);

              // Expect a minus one delta for the deposited token (since the deposit was not enough)
              await assertJoinBalanceChanges(
                joinAmounts.map((amount, i) => (i == 1 ? -1 : amount.mul(-1))),
                joinAmounts
              );

              // All internal balance was used up
              expect(await vault.connect(lp).getUserTokenBalance(lp.address, tokenAddresses[1])).to.equal(0);
            });

            it('uses internal balance exclusively if it suffices', async () => {
              // Deposit the required amount, plus one
              await vault.connect(lp).deposit(tokenAddresses[1], joinAmounts[1].add(1), lp.address);

              // Expect no delta for the deposited token (since the deposit is large enough)
              await assertJoinBalanceChanges(
                joinAmounts.map((amount, i) => (i == 1 ? 0 : amount.mul(-1))),
                joinAmounts
              );

              // The excess internal balance remains
              expect(await vault.connect(lp).getUserTokenBalance(lp.address, tokenAddresses[1])).to.equal(1);
            });
          });
        });

        context('with insufficient maximum amounts in', () => {
          beforeEach(async () => {
            joinAmounts = [];
            for (let i = 0; i < tokenAmount; ++i) {
              joinAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
            }

            maxAmountsIn = joinAmounts.map((amount, index) => (index == 1 ? amount.sub(1) : amount));

            await pool.setOnJoinPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
          });

          it('reverts if not withdrawing from internal balance', async () => {
            withdrawFromInternalBalance = false;
            await expect(callJoinPool()).to.be.revertedWith('ERR_JOIN_ABOVE_MAX');
          });

          it('reverts if withdrawing from internal balance', async () => {
            // Deposit sufficient internal balance for all tokens
            await Promise.all(
              tokenAddresses.map((token, i) => vault.connect(lp).deposit(token, joinAmounts[i], lp.address))
            );

            // The limit is enforced even if tokens need not be transferred
            withdrawFromInternalBalance = true;
            await expect(callJoinPool()).to.be.revertedWith('ERR_JOIN_ABOVE_MAX');
          });
        });
      });

      context('with due protocol fees', () => {
        beforeEach(async () => {
          // Perform an initial join so that the pool has balance that can be charged as fees
          await pool.setOnJoinPoolReturnValues(Array(tokenAmount).fill((50e18).toString()), Array(tokenAmount).fill(0));

          await vault
            .connect(lp)
            .joinPool(poolId, other.address, tokenAddresses, Array(tokenAmount).fill(MAX_UINT256), false, '0x');

          dueProtocolFeeAmounts = [];
          for (let i = 0; i < tokenAmount; ++i) {
            dueProtocolFeeAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
          }

          // No point in testing checks related to maxAmountsIn or internal balance - these are unrelated
          maxAmountsIn = Array(tokenAddresses.length).fill(MAX_UINT256);
          withdrawFromInternalBalance = false;
        });

        context('with join amounts larger than the fees', () => {
          beforeEach(async () => {
            // The join amount is larger than fees for the first token by 1, for the second by 2, and so on
            joinAmounts = dueProtocolFeeAmounts.map((feeAmount, index) => feeAmount.add(1 + index));

            await pool.setOnJoinPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
          });

          it('increases pool balance by the difference between join amount and fees ', async () => {
            await assertJoinBalanceChanges(
              joinAmounts.map((amount) => amount.mul(-1)),
              joinAmounts.map((_, index) => 1 + index)
            );
          });
        });

        context('with join amounts smaller than the fees', () => {
          beforeEach(async () => {
            // The join amount is smaller than fees for the first token by 1, for the second by 2, and so on
            joinAmounts = dueProtocolFeeAmounts.map((feeAmount, index) => feeAmount.sub(1 + index));

            await pool.setOnJoinPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
          });

          it('decreases pool balance by the difference between join amount and fees ', async () => {
            await assertJoinBalanceChanges(
              joinAmounts.map((amount) => amount.mul(-1)),
              joinAmounts.map((_, index) => -1 - index)
            );
          });
        });
      });

      describe('failure modes', () => {
        beforeEach(async () => {
          maxAmountsIn = Array(tokenAddresses.length).fill(MAX_UINT256);
          joinAmounts = Array(tokenAddresses.length).fill(0);
          dueProtocolFeeAmounts = Array(tokenAddresses.length).fill(0);
        });

        it('reverts if the length of the tokens and amount arrays is not the same', async () => {
          await expect(
            vault.connect(lp).joinPool(poolId, other.address, tokenAddresses, maxAmountsIn.slice(1), false, '0x')
          ).to.be.revertedWith('ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH');

          await expect(
            vault
              .connect(lp)
              .joinPool(poolId, other.address, tokenAddresses, [...maxAmountsIn, maxAmountsIn[0]], false, '0x')
          ).to.be.revertedWith('ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH');
        });

        it('reverts if passing less or more tokens', async () => {
          await expect(
            vault
              .connect(lp)
              .joinPool(poolId, other.address, tokenAddresses.slice(1), maxAmountsIn.slice(1), false, '0x')
          ).to.be.revertedWith('ERR_TOKENS_MISMATCH');

          await expect(
            vault
              .connect(lp)
              .joinPool(
                poolId,
                other.address,
                [...tokenAddresses, tokenAddresses[0]],
                [...maxAmountsIn, maxAmountsIn[0]],
                false,
                '0x'
              )
          ).to.be.revertedWith('ERR_TOKENS_MISMATCH');
        });

        it('reverts if passing an unordered token list', async () => {
          await expect(
            vault
              .connect(lp)
              .joinPool(
                poolId,
                other.address,
                [tokenAddresses[1], tokenAddresses[0], ...tokenAddresses.slice(2)],
                maxAmountsIn,
                false,
                '0x'
              )
          ).to.be.revertedWith('ERR_TOKENS_MISMATCH');
        });

        it('reverts if the pool returns less or more amounts than expected', async () => {
          await pool.setOnJoinPoolReturnValues(joinAmounts.slice(1), dueProtocolFeeAmounts);

          await expect(
            vault.connect(lp).joinPool(poolId, other.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');

          await pool.setOnJoinPoolReturnValues([...joinAmounts, joinAmounts[0]], dueProtocolFeeAmounts);

          await expect(
            vault.connect(lp).joinPool(poolId, other.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');
        });

        it('reverts if the pool returns less or more due protocol fees than expected', async () => {
          await pool.setOnJoinPoolReturnValues(joinAmounts, dueProtocolFeeAmounts.slice(1));

          await expect(
            vault.connect(lp).joinPool(poolId, other.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH');

          await pool.setOnJoinPoolReturnValues(joinAmounts, [...dueProtocolFeeAmounts, dueProtocolFeeAmounts[0]]);

          await expect(
            vault.connect(lp).joinPool(poolId, other.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH');
        });
      });
    });
  }
});
