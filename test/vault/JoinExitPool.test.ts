import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { deployTokens, mintTokens, TokenList } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { PoolSpecializationSetting, MinimalSwapInfoPool, GeneralPool, TwoTokenPool } from '../../scripts/helpers/pools';
import { expectBalanceChange } from '../helpers/tokenBalance';

let admin: SignerWithAddress;
let lp: SignerWithAddress;
let recipient: SignerWithAddress;

let authorizer: Contract;
let vault: Contract;
let symbols: string[];
let tokens: TokenList = {};
let tokenAddresses: string[];

describe('Vault - join & exit pool', () => {
  before(async () => {
    [, admin, lp, recipient] = await ethers.getSigners();
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

  function symbol(tokenAddress: string): string {
    for (const symbol in tokens) {
      if (tokens[symbol].address.toLowerCase() === tokenAddress.toLowerCase()) {
        return symbol;
      }
    }

    throw new Error(`Symbol for token ${tokenAddresses} not found`);
  }

  describe('joinPool', async () => {
    describe('with general pool', () => {
      itJoinsPoolCorrectly(GeneralPool, 3);
    });

    describe('with minimal swap info pool', () => {
      itJoinsPoolCorrectly(MinimalSwapInfoPool, 3);
    });

    describe('with two token pool', () => {
      itJoinsPoolCorrectly(TwoTokenPool, 2);
    });

    function itJoinsPoolCorrectly(specialization: PoolSpecializationSetting, tokenAmount: number) {
      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        pool = await deploy('MockPool', { args: [vault.address, specialization] });
        poolId = await pool.getPoolId();

        tokenAddresses = tokenAddresses
          .slice(0, tokenAmount)
          .map((address) => address.toLowerCase())
          .sort();

        await pool.registerTokens(tokenAddresses, Array(tokenAmount).fill(ZERO_ADDRESS));

        // Perform an initial join so that the pool has balance that can be charged as fees
        await pool.setOnJoinExitPoolReturnValues(
          Array(tokenAmount).fill((50e18).toString()),
          Array(tokenAmount).fill(0)
        );

        await vault
          .connect(lp)
          .joinPool(poolId, recipient.address, tokenAddresses, Array(tokenAmount).fill(MAX_UINT256), false, '0x');
      });

      let joinAmounts: BigNumber[];
      let dueProtocolFeeAmounts: BigNumber[];

      let maxAmountsIn: BigNumber[];
      let withdrawFromInternalBalance: boolean;

      function callJoinPool() {
        return vault
          .connect(lp)
          .joinPool(poolId, recipient.address, tokenAddresses, maxAmountsIn, withdrawFromInternalBalance, '0x');
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
        await expectBalanceChange(callJoinPool, tokens, [{ account: lp, changes }, { account: recipient }]);

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
        beforeEach(() => {
          dueProtocolFeeAmounts = Array(tokenAddresses.length).fill(0);
        });

        context('with sufficient maximum amounts in', () => {
          beforeEach(() => {
            maxAmountsIn = Array(tokenAddresses.length).fill(MAX_UINT256);
          });

          context('without withdrawing from internal balance', () => {
            beforeEach(() => {
              withdrawFromInternalBalance = false;
            });

            it('allows zero-token joins', async () => {
              joinAmounts = Array(tokenAddresses.length).fill(0);
              await pool.setOnJoinExitPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);

              await assertJoinBalanceChanges(Array(tokenAmount).fill(0), Array(tokenAmount).fill(0));
            });

            context('with non-zero join amounts', () => {
              beforeEach(async () => {
                joinAmounts = [];
                for (let i = 0; i < tokenAmount; ++i) {
                  joinAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
                }

                await pool.setOnJoinExitPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
              });

              it('grants tokens to the pool', async () => {
                await assertJoinBalanceChanges(
                  joinAmounts.map((amount) => amount.mul(-1)),
                  joinAmounts
                );
              });

              it.skip('passes expected values to the pool');
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

              await pool.setOnJoinExitPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
            });

            it('transfers all tokens if internal balance is zero', async () => {
              await assertJoinBalanceChanges(
                joinAmounts.map((amount) => amount.mul(-1)),
                joinAmounts
              );
            });

            it('uses both token transfers and internal balance if it is not enough', async () => {
              // Deposit the required amount, minus one
              await vault.connect(lp).depositToInternalBalance(tokenAddresses[1], joinAmounts[1].sub(1), lp.address);

              // Expect a minus one delta for the deposited token (since the deposit was not enough)
              await assertJoinBalanceChanges(
                joinAmounts.map((amount, i) => (i == 1 ? -1 : amount.mul(-1))),
                joinAmounts
              );

              // All internal balance was used up
              expect(await vault.connect(lp).getInternalBalance(lp.address, tokenAddresses[1])).to.equal(0);
            });

            it('uses internal balance exclusively if it suffices', async () => {
              // Deposit the required amount, plus one
              await vault.connect(lp).depositToInternalBalance(tokenAddresses[1], joinAmounts[1].add(1), lp.address);

              // Expect no delta for the deposited token (since the deposit is large enough)
              await assertJoinBalanceChanges(
                joinAmounts.map((amount, i) => (i == 1 ? 0 : amount.mul(-1))),
                joinAmounts
              );

              // The excess internal balance remains
              expect(await vault.connect(lp).getInternalBalance(lp.address, tokenAddresses[1])).to.equal(1);
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

            await pool.setOnJoinExitPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
          });

          it('reverts if not withdrawing from internal balance', async () => {
            withdrawFromInternalBalance = false;
            await expect(callJoinPool()).to.be.revertedWith('ERR_JOIN_ABOVE_MAX');
          });

          it('reverts if withdrawing from internal balance', async () => {
            // Deposit sufficient internal balance for all tokens
            await Promise.all(
              tokenAddresses.map((token, i) =>
                vault.connect(lp).depositToInternalBalance(token, joinAmounts[i], lp.address)
              )
            );

            // The limit is enforced even if tokens need not be transferred
            withdrawFromInternalBalance = true;
            await expect(callJoinPool()).to.be.revertedWith('ERR_JOIN_ABOVE_MAX');
          });
        });
      });

      context('with due protocol fees', () => {
        beforeEach(async () => {
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

            await pool.setOnJoinExitPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
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

            await pool.setOnJoinExitPoolReturnValues(joinAmounts, dueProtocolFeeAmounts);
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
            vault.connect(lp).joinPool(poolId, recipient.address, tokenAddresses, maxAmountsIn.slice(1), false, '0x')
          ).to.be.revertedWith('ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH');

          await expect(
            vault
              .connect(lp)
              .joinPool(poolId, recipient.address, tokenAddresses, [...maxAmountsIn, maxAmountsIn[0]], false, '0x')
          ).to.be.revertedWith('ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH');
        });

        it('reverts if passing less or more tokens', async () => {
          await expect(
            vault
              .connect(lp)
              .joinPool(poolId, recipient.address, tokenAddresses.slice(1), maxAmountsIn.slice(1), false, '0x')
          ).to.be.revertedWith('ERR_TOKENS_MISMATCH');

          await expect(
            vault
              .connect(lp)
              .joinPool(
                poolId,
                recipient.address,
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
                recipient.address,
                [tokenAddresses[1], tokenAddresses[0], ...tokenAddresses.slice(2)],
                maxAmountsIn,
                false,
                '0x'
              )
          ).to.be.revertedWith('ERR_TOKENS_MISMATCH');
        });

        it('reverts if the pool returns less or more amounts than expected', async () => {
          await pool.setOnJoinExitPoolReturnValues(joinAmounts.slice(1), dueProtocolFeeAmounts);

          await expect(
            vault.connect(lp).joinPool(poolId, recipient.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');

          await pool.setOnJoinExitPoolReturnValues([...joinAmounts, joinAmounts[0]], dueProtocolFeeAmounts);

          await expect(
            vault.connect(lp).joinPool(poolId, recipient.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');
        });

        it('reverts if the pool returns less or more due protocol fees than expected', async () => {
          await pool.setOnJoinExitPoolReturnValues(joinAmounts, dueProtocolFeeAmounts.slice(1));

          await expect(
            vault.connect(lp).joinPool(poolId, recipient.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH');

          await pool.setOnJoinExitPoolReturnValues(joinAmounts, [...dueProtocolFeeAmounts, dueProtocolFeeAmounts[0]]);

          await expect(
            vault.connect(lp).joinPool(poolId, recipient.address, tokenAddresses, maxAmountsIn, false, '0x')
          ).to.be.revertedWith('ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH');
        });
      });
    }
  });

  describe('exitPool', async () => {
    describe('with general pool', () => {
      itExitsPoolCorrectly(GeneralPool, 3);
    });

    describe('with minimal swap info pool', () => {
      itExitsPoolCorrectly(MinimalSwapInfoPool, 3);
    });

    describe('with two token pool', () => {
      itExitsPoolCorrectly(TwoTokenPool, 2);
    });

    function itExitsPoolCorrectly(specialization: PoolSpecializationSetting, tokenAmount: number) {
      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        pool = await deploy('MockPool', { args: [vault.address, specialization] });
        poolId = await pool.getPoolId();

        tokenAddresses = tokenAddresses
          .slice(0, tokenAmount)
          .map((address) => address.toLowerCase())
          .sort();

        await pool.registerTokens(tokenAddresses, Array(tokenAmount).fill(ZERO_ADDRESS));

        // Perform an initial join so that the pool has balance that can be exited and charged as fees
        await pool.setOnJoinExitPoolReturnValues(
          Array(tokenAmount).fill((50e18).toString()),
          Array(tokenAmount).fill(0)
        );

        await vault
          .connect(lp)
          .joinPool(poolId, recipient.address, tokenAddresses, Array(tokenAmount).fill(MAX_UINT256), false, '0x');
      });

      let exitAmounts: BigNumber[];
      let dueProtocolFeeAmounts: BigNumber[];

      let minAmountsOut: BigNumber[];
      let depositToInternalBalance: boolean;

      function callExitPool() {
        return vault
          .connect(lp)
          .exitPool(poolId, recipient.address, tokenAddresses, minAmountsOut, depositToInternalBalance, '0x');
      }

      // TODO: merge with assertJoinBalanceChanges
      async function assertExitBalanceChanges(
        expectedRecipientDeltas: BigNumberish[],
        expectedPoolDeltas: BigNumberish[]
      ) {
        const prePoolBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);
        const preCollectedFees = await Promise.all(tokenAddresses.map((token) => vault.getCollectedFeesByToken(token)));

        const changes = Object.assign(
          {},
          ...expectedRecipientDeltas.map((delta, i) => {
            return { [symbol(tokenAddresses[i])]: delta };
          })
        );
        await expectBalanceChange(callExitPool, tokens, [{ account: lp }, { account: recipient, changes }]);

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
        beforeEach(() => {
          dueProtocolFeeAmounts = Array(tokenAddresses.length).fill(0);
        });

        context('with sufficient minimum amounts out', () => {
          beforeEach(() => {
            minAmountsOut = Array(tokenAddresses.length).fill(0);
          });

          context('without depositing to internal balance', () => {
            beforeEach(() => {
              depositToInternalBalance = false;
            });

            it('allows zero-token exits', async () => {
              exitAmounts = Array(tokenAddresses.length).fill(0);
              await pool.setOnJoinExitPoolReturnValues(exitAmounts, dueProtocolFeeAmounts);

              await assertExitBalanceChanges(Array(tokenAmount).fill(0), Array(tokenAmount).fill(0));
            });

            context('with non-zero exit amounts', () => {
              beforeEach(async () => {
                exitAmounts = [];
                for (let i = 0; i < tokenAmount; ++i) {
                  exitAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
                }

                await pool.setOnJoinExitPoolReturnValues(exitAmounts, dueProtocolFeeAmounts);
              });

              it('takes tokens from the pool', async () => {
                await assertExitBalanceChanges(
                  exitAmounts,
                  exitAmounts.map((amount) => amount.mul(-1))
                );
              });

              it.skip('passes expected values to the pool');

              it.skip('charges withdrawal fees');
            });
          });

          context('depositing to internal balance', () => {
            beforeEach(async () => {
              depositToInternalBalance = true;

              exitAmounts = [];
              for (let i = 0; i < tokenAmount; ++i) {
                exitAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
              }

              await pool.setOnJoinExitPoolReturnValues(exitAmounts, dueProtocolFeeAmounts);
            });

            it('deposits tokens to for the recipient', async () => {
              const preInternalBalance = await Promise.all(
                tokenAddresses.map((token) => vault.getInternalBalance(recipient.address, token))
              );

              await assertExitBalanceChanges(
                Array(tokenAmount).fill(0),
                exitAmounts.map((amount) => amount.mul(-1))
              );

              const postInternalBalance = await Promise.all(
                tokenAddresses.map((token) => vault.getInternalBalance(recipient.address, token))
              );

              const internalBalanceDeltas = [];
              for (let i = 0; i < tokenAmount; ++i) {
                internalBalanceDeltas.push(postInternalBalance[i].sub(preInternalBalance[i]));
              }

              expect(internalBalanceDeltas).to.deep.equal(exitAmounts);
            });

            it.skip('does not charge withdrawal fees');
          });

          context('with insufficient minimum amounts out', () => {
            beforeEach(async () => {
              exitAmounts = [];
              for (let i = 0; i < tokenAmount; ++i) {
                exitAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
              }

              minAmountsOut = exitAmounts.map((amount, index) => (index == 1 ? amount.add(1) : amount));

              await pool.setOnJoinExitPoolReturnValues(exitAmounts, dueProtocolFeeAmounts);
            });

            it('reverts if not depositing to internal balance', async () => {
              depositToInternalBalance = false;
              await expect(callExitPool()).to.be.revertedWith('ERR_EXIT_BELOW_MIN');
            });

            it('reverts if depositing to internal balance and transferring no tokens', async () => {
              depositToInternalBalance = true;
              await expect(callExitPool()).to.be.revertedWith('ERR_EXIT_BELOW_MIN');
            });
          });
        });

        context('with due protocol fees', () => {
          beforeEach(async () => {
            dueProtocolFeeAmounts = [];
            for (let i = 0; i < tokenAmount; ++i) {
              dueProtocolFeeAmounts.push(BigNumber.from(((i + 1) * 1e18).toString()));
            }

            // No point in testing checks related to minAmountsOut or internal balance - these are unrelated
            minAmountsOut = Array(tokenAddresses.length).fill(0);
            depositToInternalBalance = false;
          });

          it('decreases pool balance by the sum of exit amounts and fees ', async () => {
            // The exit amount is larger than fees for the first token by 1, for the second by 2, and so on
            exitAmounts = dueProtocolFeeAmounts.map((feeAmount, index) => feeAmount.add(1 + index));

            await pool.setOnJoinExitPoolReturnValues(exitAmounts, dueProtocolFeeAmounts);

            await assertExitBalanceChanges(
              exitAmounts,
              dueProtocolFeeAmounts.map((amount, index) =>
                amount
                  .mul(2)
                  .add(1 + index)
                  .mul(-1)
              )
            );
          });
        });

        describe('failure modes', () => {
          beforeEach(() => {
            minAmountsOut = Array(tokenAddresses.length).fill(0);
            exitAmounts = Array(tokenAddresses.length).fill(MAX_UINT256);
            dueProtocolFeeAmounts = Array(tokenAddresses.length).fill(0);
          });

          it('reverts if the length of the tokens and amount arrays is not the same', async () => {
            await expect(
              vault.connect(lp).exitPool(poolId, recipient.address, tokenAddresses, minAmountsOut.slice(1), false, '0x')
            ).to.be.revertedWith('ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH');

            await expect(
              vault
                .connect(lp)
                .exitPool(poolId, recipient.address, tokenAddresses, [...minAmountsOut, minAmountsOut[0]], false, '0x')
            ).to.be.revertedWith('ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH');
          });

          it('reverts if passing less or more tokens', async () => {
            await expect(
              vault
                .connect(lp)
                .exitPool(poolId, recipient.address, tokenAddresses.slice(1), minAmountsOut.slice(1), false, '0x')
            ).to.be.revertedWith('ERR_TOKENS_MISMATCH');

            await expect(
              vault
                .connect(lp)
                .exitPool(
                  poolId,
                  recipient.address,
                  [...tokenAddresses, tokenAddresses[0]],
                  [...minAmountsOut, minAmountsOut[0]],
                  false,
                  '0x'
                )
            ).to.be.revertedWith('ERR_TOKENS_MISMATCH');
          });

          it('reverts if passing an unordered token list', async () => {
            await expect(
              vault
                .connect(lp)
                .exitPool(
                  poolId,
                  recipient.address,
                  [tokenAddresses[1], tokenAddresses[0], ...tokenAddresses.slice(2)],
                  minAmountsOut,
                  false,
                  '0x'
                )
            ).to.be.revertedWith('ERR_TOKENS_MISMATCH');
          });

          it('reverts if the pool returns less or more amounts than expected', async () => {
            await pool.setOnJoinExitPoolReturnValues(exitAmounts.slice(1), dueProtocolFeeAmounts);

            await expect(
              vault.connect(lp).exitPool(poolId, recipient.address, tokenAddresses, minAmountsOut, false, '0x')
            ).to.be.revertedWith('ERR_AMOUNTS_OUT_LENGTH');

            await pool.setOnJoinExitPoolReturnValues([...exitAmounts, exitAmounts[0]], dueProtocolFeeAmounts);

            await expect(
              vault.connect(lp).exitPool(poolId, recipient.address, tokenAddresses, minAmountsOut, false, '0x')
            ).to.be.revertedWith('ERR_AMOUNTS_OUT_LENGTH');
          });

          it('reverts if the pool returns less or more due protocol fees than expected', async () => {
            await pool.setOnJoinExitPoolReturnValues(exitAmounts, dueProtocolFeeAmounts.slice(1));

            await expect(
              vault.connect(lp).exitPool(poolId, recipient.address, tokenAddresses, minAmountsOut, false, '0x')
            ).to.be.revertedWith('ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH');

            await pool.setOnJoinExitPoolReturnValues(exitAmounts, [...dueProtocolFeeAmounts, dueProtocolFeeAmounts[0]]);

            await expect(
              vault.connect(lp).exitPool(poolId, recipient.address, tokenAddresses, minAmountsOut, false, '0x')
            ).to.be.revertedWith('ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH');
          });
        });
      });
    }
  });
});
