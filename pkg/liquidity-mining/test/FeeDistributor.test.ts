import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceToTimestamp, currentTimestamp, DAY, receiptTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { parseFixed } from '@ethersproject/bignumber';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

const roundDownTimestamp = (timestamp: BigNumberish): BigNumber => {
  return BigNumber.from(timestamp).div(WEEK).mul(WEEK);
};

const roundUpTimestamp = (timestamp: BigNumberish): BigNumber => {
  return roundDownTimestamp(BigNumber.from(timestamp).add(WEEK).sub(1));
};

const advanceToNextWeek = async (): Promise<void> => {
  const nextWeek = roundUpTimestamp(await currentTimestamp());
  await advanceToTimestamp(nextWeek);
};

function expectTimestampsMatch(timestamp: BigNumberish, expectedTimestamp: BigNumberish): void {
  const weekNumber = BigNumber.from(timestamp).div(WEEK).toNumber();
  const expectedWeekNumber = BigNumber.from(expectedTimestamp).div(WEEK).toNumber();
  expect(timestamp, `Timestamp is ${weekNumber - expectedWeekNumber} weeks off`).to.be.eq(expectedTimestamp);
}

describe('FeeDistributor', () => {
  let bpt: Token;
  let votingEscrow: Contract;
  let feeDistributor: Contract;

  let startTime: BigNumber;

  let user1: SignerWithAddress, user2: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, user1, user2, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy fee distributor', async () => {
    bpt = await Token.create('BPT');
    votingEscrow = await deploy('VotingEscrow', {
      args: [bpt.address, 'Vote Escrowed Balancer BPT', 'veBAL', ANY_ADDRESS],
    });

    // startTime is rounded up to the beginning of next week
    startTime = roundUpTimestamp(await currentTimestamp());
    feeDistributor = await deploy('FeeDistributor', {
      args: [votingEscrow.address, startTime],
    });
  });

  sharedBeforeEach('lock BPT into VotingEscrow', async () => {
    const bptAmount = parseFixed('1', 18);
    await createLockForUser(user1, bptAmount, 365 * DAY);
    await createLockForUser(user2, bptAmount, 365 * DAY);

    expect(await votingEscrow['balanceOf(address)'](user1.address)).to.be.gt(0, 'zero veBAL balance');
    expect(await votingEscrow['totalSupply()']()).to.be.gt(0, 'zero veBAL supply');
  });

  async function createLockForUser(
    user: SignerWithAddress,
    amount: BigNumberish,
    lockDuration: BigNumberish
  ): Promise<void> {
    await bpt.mint(user, amount);
    await bpt.approve(votingEscrow, amount, { from: user });
    const now = await currentTimestamp();
    await votingEscrow.connect(user).create_lock(amount, now.add(lockDuration));
  }

  async function expectConsistentUserBalance(user: Account, timestamp: BigNumberish): Promise<void> {
    const userAddress = TypesConverter.toAddress(user);
    const cachedBalance = feeDistributor.getUserBalanceAtTimestamp(userAddress, timestamp);
    const expectedBalance = votingEscrow['balanceOf(address,uint256)'](userAddress, timestamp);
    expect(await cachedBalance).to.be.eq(await expectedBalance);
  }

  async function expectConsistentTotalSupply(timestamp: BigNumberish): Promise<void> {
    const cachedSupply = feeDistributor.getTotalSupplyAtTimestamp(timestamp);
    const expectedSupply = votingEscrow['totalSupply(uint256)'](timestamp);
    expect(await cachedSupply).to.be.eq(await expectedSupply);
  }

  describe('constructor', () => {
    it('sets the VotingEscrow contract address', async () => {
      expect(await feeDistributor.getVotingEscrow()).to.be.eq(votingEscrow.address);
    });

    it('sets the time cursor to the expected value', async () => {
      expectTimestampsMatch(await feeDistributor.getTimeCursor(), startTime);
    });
  });

  describe('checkpointing', () => {
    describe('global checkpoint', () => {
      context('when startTime has not passed', () => {
        it('does nothing', async () => {
          expectTimestampsMatch(await feeDistributor.getTimeCursor(), startTime);
          expect(await feeDistributor.getTotalSupplyAtTimestamp(startTime)).to.be.eq(0);

          await feeDistributor.checkpoint();

          expectTimestampsMatch(await feeDistributor.getTimeCursor(), startTime);
          expect(await feeDistributor.getTotalSupplyAtTimestamp(startTime)).to.be.eq(0);
        });
      });

      context('when startTime has passed', () => {
        sharedBeforeEach('advance time past startTime', async () => {
          await advanceToTimestamp(startTime);
        });

        context('when the contract has already been checkpointed', () => {
          let nextWeek: BigNumber;

          sharedBeforeEach('checkpoint contract', async () => {
            // We checkpoint the contract so that the next time
            // we call this function there will be no update to perform.
            const tx = await feeDistributor.checkpoint();
            nextWeek = roundUpTimestamp(await receiptTimestamp(tx.wait()));
          });

          it('nothing happens', async () => {
            expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);

            await feeDistributor.checkpoint();

            expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);
          });
        });

        context('when the contract has not been checkpointed this week', () => {
          let start: BigNumber;
          let end: BigNumber;

          sharedBeforeEach('advance time past startTime', async () => {
            start = roundUpTimestamp(await currentTimestamp());
          });

          function testCheckpoint() {
            let numWeeks: number;
            let checkpointTimestamps: BigNumber[];

            sharedBeforeEach('advance time to end of period to checkpoint', async () => {
              numWeeks = roundDownTimestamp(end).sub(roundDownTimestamp(start)).div(WEEK).toNumber();
              checkpointTimestamps = Array.from({ length: numWeeks }, (_, i) =>
                roundDownTimestamp(start).add(i * WEEK)
              );
              await advanceToTimestamp(end);
            });

            it('advances the global time cursor to the start of the next week', async () => {
              expectTimestampsMatch(await feeDistributor.getTimeCursor(), start);

              const tx = await feeDistributor.checkpoint();

              const txTimestamp = await receiptTimestamp(tx.wait());
              // Add 1 as if the transaction falls exactly on the beginning of the week
              // then we also go to the end of the week as we can read the current balance
              const nextWeek = roundUpTimestamp(txTimestamp + 1);

              expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);
            });

            it('stores the VotingEscrow supply at the start of each week', async () => {
              for (let i = 0; i < numWeeks; i++) {
                expect(await feeDistributor.getTotalSupplyAtTimestamp(checkpointTimestamps[i])).to.be.eq(0);
              }

              await feeDistributor.checkpoint();

              for (let i = 0; i < numWeeks; i++) {
                await expectConsistentTotalSupply(checkpointTimestamps[i]);
              }
            });
          }

          context("when the contract hasn't checkpointed in a small number of weeks", () => {
            sharedBeforeEach('set end timestamp', async () => {
              end = start.add(8 * WEEK - 1);
            });
            testCheckpoint();
          });
        });
      });
    });

    describe('user checkpoint', () => {
      describe('checkpointUser', () => {
        context('when startTime has not passed', () => {
          it('does not advance the user time cursor past startTime', async () => {
            expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), 0);

            await feeDistributor.checkpointUser(user1.address);

            expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), startTime);

            await feeDistributor.checkpointUser(user1.address);

            expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), startTime);
          });

          it("does not write a value for user's balance at startTime", async () => {
            expectTimestampsMatch(await feeDistributor.getUserBalanceAtTimestamp(user1.address, startTime), 0);

            await feeDistributor.checkpointUser(user1.address);

            expectTimestampsMatch(await feeDistributor.getUserBalanceAtTimestamp(user1.address, startTime), 0);
          });
        });

        context('when startTime has passed', () => {
          context('when the user has already been checkpointed', () => {
            let nextWeek: BigNumber;

            sharedBeforeEach('checkpoint contract', async () => {
              // We checkpoint the contract so that the next time
              // we call this function there will be no update to perform.
              const tx = await feeDistributor.checkpointUser(user1.address);
              nextWeek = roundUpTimestamp(await receiptTimestamp(tx.wait()));
            });

            it('nothing happens', async () => {
              expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);

              await feeDistributor.checkpointUser(user1.address);

              expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);
            });
          });

          context('when the user has not been checkpointed this week', () => {
            let user: SignerWithAddress;
            let start: BigNumber;
            let end: BigNumber;

            sharedBeforeEach('advance time past startTime', async () => {
              await advanceToTimestamp(startTime.add(1));

              start = await currentTimestamp();
            });

            function testCheckpoint() {
              // These tests will begin to fail as we increase the number of weeks which we are checkpointing
              // This is as `_checkpointUserBalance` is limited to perform at most 50 iterations minus the number
              // of user epochs in the period being checkpointed.
              let numWeeks: number;
              let checkpointTimestamps: BigNumber[];

              sharedBeforeEach('advance time to end of period to checkpoint', async () => {
                numWeeks = roundDownTimestamp(end).sub(roundDownTimestamp(start)).div(WEEK).toNumber();
                checkpointTimestamps = Array.from({ length: numWeeks }, (_, i) =>
                  roundDownTimestamp(start).add(i * WEEK)
                );
                await advanceToTimestamp(end);
              });

              it("advances the user's time cursor to the start of the next week", async () => {
                expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), 0);

                const tx = await feeDistributor.checkpointUser(user.address);

                const txTimestamp = await receiptTimestamp(tx.wait());
                // Add 1 as if the transaction falls exactly on the beginning of the week
                // then we also go to the end of the week as we can read the current balance
                const nextWeek = roundUpTimestamp(txTimestamp + 1);

                expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), nextWeek);
              });

              it("stores the user's balance at the start of each week", async () => {
                for (let i = 0; i < numWeeks; i++) {
                  expect(
                    await feeDistributor.getUserBalanceAtTimestamp(user.address, checkpointTimestamps[i])
                  ).to.be.eq(0);
                }

                await feeDistributor.checkpointUser(user.address);

                for (let i = 0; i < numWeeks; i++) {
                  await expectConsistentUserBalance(user, checkpointTimestamps[i]);
                }
              });
            }

            context("when user hasn't checkpointed in a small number of weeks", () => {
              sharedBeforeEach('set end timestamp', async () => {
                end = start.add(8 * WEEK - 1);
              });
              context('when user locked prior to the beginning of the week', () => {
                sharedBeforeEach('set user', async () => {
                  user = user1;
                });
                testCheckpoint();
              });

              context('when user locked after the beginning of the week', () => {
                sharedBeforeEach('set user', async () => {
                  user = other;
                  await createLockForUser(other, parseFixed('1', 18), 365 * DAY);
                });
                testCheckpoint();

                it('records a zero balance for the week in which they lock', async () => {
                  expect(await feeDistributor.getUserBalanceAtTimestamp(user.address, startTime)).to.be.eq(0);

                  await feeDistributor.checkpointUser(user.address);

                  await expectConsistentUserBalance(user, startTime);
                });
              });
            });
          });
        });
      });
    });

    describe('token checkpoint', () => {
      let tokens: TokenList;
      let tokenAmounts: BigNumber[];

      function itCheckpointsTokensCorrectly(checkpointTokens: () => Promise<ContractTransaction>): void {
        context('when startTime has not passed', () => {
          it('reverts', async () => {
            await expect(checkpointTokens()).to.be.revertedWith('Fee distribution has not started yet');
          });
        });

        context('when startTime has passed', () => {
          sharedBeforeEach('advance time past startTime', async () => {
            await advanceToTimestamp(startTime.add(100));
          });

          it("updates the token's time cursor to the current timestamp", async () => {
            const tx = await checkpointTokens();

            for (const token of tokens.addresses) {
              const tokenTimeCursor = await feeDistributor.getTokenTimeCursor(token);
              const txTimestamp = await receiptTimestamp(tx.wait());
              expectTimestampsMatch(tokenTimeCursor, txTimestamp);
            }
          });

          context("when FeeDistributor hasn't received new tokens", () => {
            sharedBeforeEach('send tokens and checkpoint', async () => {
              for (const [index, token] of tokens.tokens.entries()) {
                await token.mint(feeDistributor, tokenAmounts[index]);
              }
              await feeDistributor.checkpointTokens(tokens.addresses);
            });

            it('maintains the same cached balance', async () => {
              const expectedTokenLastBalances = await Promise.all(
                tokens.addresses.map((token) => feeDistributor.getTokenLastBalance(token))
              );
              await checkpointTokens();

              for (const [index, token] of tokens.addresses.entries()) {
                expect(await feeDistributor.getTokenLastBalance(token)).to.be.eq(expectedTokenLastBalances[index]);
              }
            });
          });

          context('when FeeDistributor has received new tokens', () => {
            sharedBeforeEach('send tokens', async () => {
              for (const [index, token] of tokens.tokens.entries()) {
                await token.mint(feeDistributor, tokenAmounts[index]);
              }
            });

            it('emits a TokenCheckpointedEvent', async () => {
              const tx = await checkpointTokens();

              for (const [index, token] of tokens.tokens.entries()) {
                expectEvent.inReceipt(await tx.wait(), 'TokenCheckpointed', {
                  token: token.address,
                  amount: tokenAmounts[index],
                });
              }
            });

            it('updates the cached balance by the amount of new tokens received', async () => {
              const previousTokenLastBalances = await Promise.all(
                tokens.addresses.map((token) => feeDistributor.getTokenLastBalance(token))
              );
              await checkpointTokens();
              const newTokenLastBalances = await Promise.all(
                tokens.addresses.map((token) => feeDistributor.getTokenLastBalance(token))
              );

              for (const index in tokens.addresses) {
                expect(newTokenLastBalances[index].sub(previousTokenLastBalances[index])).to.be.eq(tokenAmounts[index]);
              }
            });
          });
        });
      }

      describe('checkpointToken', () => {
        sharedBeforeEach('Deploy protocol fee token', async () => {
          tokens = await TokenList.create(['FEE']);
          tokenAmounts = tokens.map(() => parseFixed('1', 18));
        });

        itCheckpointsTokensCorrectly(() => feeDistributor.checkpointToken(tokens.addresses[0]));
      });

      describe('checkpointTokens', () => {
        sharedBeforeEach('Deploy protocol fee token', async () => {
          tokens = await TokenList.create(['FEE', 'FEE2']);
          tokenAmounts = tokens.map(() => parseFixed('1', 18));
        });

        itCheckpointsTokensCorrectly(() => feeDistributor.checkpointTokens(tokens.addresses));
      });
    });
  });

  describe('claiming', () => {
    let tokens: TokenList;
    let tokenAmounts: BigNumber[];

    function itClaimsTokensCorrectly(
      claimTokens: () => Promise<ContractTransaction>,
      simulateClaimTokens: () => Promise<BigNumber[]>
    ): void {
      context('when startTime has not passed', () => {
        it('reverts', async () => {
          await expect(claimTokens()).to.be.revertedWith('Fee distribution has not started yet');
        });
      });

      context('when startTime has passed', () => {
        sharedBeforeEach('advance time past startTime', async () => {
          await advanceToTimestamp(startTime.add(100));
        });

        it('checkpoints the global, token and user state', async () => {
          const nextWeek = roundUpTimestamp(await currentTimestamp());
          const tx = await claimTokens();

          // Global
          expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);

          // Token
          // This only works as it is the first token checkpoint. Calls for the next day won't checkpoint
          const txTimestamp = await receiptTimestamp(tx.wait());
          for (const token of tokens.addresses) {
            const tokenTimeCursor = await feeDistributor.getTokenTimeCursor(token);
            expectTimestampsMatch(tokenTimeCursor, txTimestamp);
          }

          // User
          expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);
        });

        it('updates the token time cursor for the user to the latest claimed week', async () => {
          const thisWeek = roundDownTimestamp(await currentTimestamp());

          await claimTokens();
          for (const token of tokens.addresses) {
            expectTimestampsMatch(await feeDistributor.getUserTokenTimeCursor(user1.address, token), thisWeek);
          }
        });

        context('when there are no tokens to distribute to user', () => {
          it("doesn't emit a TokensClaimed event", async () => {
            const tx = await claimTokens();
            expectEvent.notEmitted(await tx.wait(), 'TokensClaimed');
          });

          it('maintains the same cached balance', async () => {
            const expectedTokenLastBalances = await Promise.all(
              tokens.addresses.map((token) => feeDistributor.getTokenLastBalance(token))
            );
            await claimTokens();

            for (const [index, token] of tokens.addresses.entries()) {
              expect(await feeDistributor.getTokenLastBalance(token)).to.be.eq(expectedTokenLastBalances[index]);
            }
          });

          it('returns zero', async () => {
            expect(await simulateClaimTokens()).to.be.eql(tokenAmounts.map(() => BigNumber.from(0)));
          });
        });

        context('when there are tokens to distribute to user', () => {
          sharedBeforeEach('send tokens', async () => {
            for (const [index, token] of tokens.tokens.entries()) {
              await token.mint(feeDistributor, tokenAmounts[index]);
            }
            await feeDistributor.checkpointTokens(tokens.addresses);

            // For the week to become claimable we must wait until the next week starts
            await advanceToNextWeek();
          });

          it('emits a TokensClaimed event', async () => {
            const thisWeek = roundDownTimestamp(await currentTimestamp());

            const tx = await claimTokens();
            for (const [index, token] of tokens.tokens.entries()) {
              expectEvent.inReceipt(await tx.wait(), 'TokensClaimed', {
                user: user1.address,
                token: token.address,
                amount: tokenAmounts[index].div(2),
                userTokenTimeCursor: thisWeek,
              });
            }
          });

          it('subtracts the number of tokens claimed from the cached balance', async () => {
            const previousTokenLastBalances = await Promise.all(
              tokens.addresses.map((token) => feeDistributor.getTokenLastBalance(token))
            );
            const tx = await claimTokens();
            const newTokenLastBalances = await Promise.all(
              tokens.addresses.map((token) => feeDistributor.getTokenLastBalance(token))
            );

            for (const [index, token] of tokens.tokens.entries()) {
              const {
                args: { amount },
              } = expectEvent.inReceipt(await tx.wait(), 'TokensClaimed', {
                user: user1.address,
                token: token.address,
              });
              expect(newTokenLastBalances[index]).to.be.eq(previousTokenLastBalances[index].sub(amount));
            }
          });

          it('returns the amount of tokens claimed', async () => {
            expect(await simulateClaimTokens()).to.be.eql(tokenAmounts.map((amount) => amount.div(2)));
          });
        });
      });
    }

    describe('claimToken', () => {
      sharedBeforeEach('Deploy protocol fee token', async () => {
        tokens = await TokenList.create(['FEE']);
        tokenAmounts = tokens.map(() => parseFixed('1', 18));
      });

      // Return values from static-calling claimToken need to be converted into array format to standardise test code.
      itClaimsTokensCorrectly(
        () => feeDistributor.claimToken(user1.address, tokens.addresses[0]),
        async () => [await feeDistributor.callStatic.claimToken(user1.address, tokens.addresses[0])]
      );
    });

    describe('claimTokens', () => {
      sharedBeforeEach('Deploy protocol fee token', async () => {
        tokens = await TokenList.create(['FEE', 'FEE2']);
        tokenAmounts = tokens.map(() => parseFixed('1', 18));
      });

      itClaimsTokensCorrectly(
        () => feeDistributor.claimTokens(user1.address, tokens.addresses),
        () => feeDistributor.callStatic.claimTokens(user1.address, tokens.addresses)
      );

      context('when startTime has passed', () => {
        sharedBeforeEach('advance time past startTime', async () => {
          await advanceToTimestamp(startTime.add(100));
        });

        context('when there are tokens to distribute to user', () => {
          sharedBeforeEach('send tokens', async () => {
            for (const [index, token] of tokens.tokens.entries()) {
              await token.mint(feeDistributor, tokenAmounts[index]);
            }
            await feeDistributor.checkpointTokens(tokens.addresses);

            // For the week to become claimable we must wait until the next week starts
            await advanceToNextWeek();
          });

          context('when the array of tokens contains duplicates', () => {
            it('ignores the second occurence of the token address', async () => {
              expect(await feeDistributor.callStatic.claimTokens(user1.address, tokens.addresses)).to.be.eql(
                tokenAmounts.map((amount) => amount.div(2))
              );
            });
          });
        });
      });
    });
  });
});
