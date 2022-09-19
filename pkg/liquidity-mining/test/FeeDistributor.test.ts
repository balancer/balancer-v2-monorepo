import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceToTimestamp, currentTimestamp, DAY, receiptTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { parseFixed } from '@ethersproject/bignumber';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { Comparison, expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';

const roundDownTimestamp = (timestamp: BigNumberish): BigNumber => {
  return BigNumber.from(timestamp).div(WEEK).mul(WEEK);
};

const roundUpTimestamp = (timestamp: BigNumberish): BigNumber => {
  return roundDownTimestamp(BigNumber.from(timestamp).add(WEEK).sub(1));
};

function expectTimestampsMatch(timestamp: BigNumberish, expectedTimestamp: BigNumberish): void {
  const weekNumber = BigNumber.from(timestamp).div(WEEK).toNumber();
  const expectedWeekNumber = BigNumber.from(expectedTimestamp).div(WEEK).toNumber();
  const difference = weekNumber - expectedWeekNumber;
  expect(
    timestamp,
    `Timestamp is ${Math.abs(difference)} weeks ${difference > 0 ? 'ahead' : 'behind'} expected value`
  ).to.be.eq(expectedTimestamp);
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
    feeDistributor = await deploy('TestFeeDistributor', {
      args: [votingEscrow.address, startTime],
    });
  });

  sharedBeforeEach('lock BPT into VotingEscrow', async () => {
    const bptAmount = parseFixed('1', 18);
    await createLockForUser(user1, bptAmount, 365 * DAY);
    await createLockForUser(user2, bptAmount.mul(2), 365 * DAY);
    // User 1 owns a third of the locked BPT - they'll have about a third of the veBAL supply (not exactly due to how
    // decaying works).

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

  async function depositForUser(user: SignerWithAddress, amount: BigNumberish): Promise<void> {
    await bpt.mint(user, amount);
    await bpt.approve(votingEscrow, amount, { from: user });
    await votingEscrow.connect(user).deposit_for(user.address, amount);
  }

  function getWeekTimestamps(end: BigNumberish): BigNumber[] {
    const numWeeks = roundDownTimestamp(end).sub(roundDownTimestamp(startTime)).div(WEEK).toNumber();
    return Array.from({ length: numWeeks }, (_, i) => roundDownTimestamp(startTime).add(i * WEEK));
  }

  async function expectConsistentUserBalance(user: Account, timestamp: BigNumberish): Promise<void> {
    const userAddress = TypesConverter.toAddress(user);
    const cachedBalance = feeDistributor.getUserBalanceAtTimestamp(userAddress, timestamp);
    const expectedBalance = votingEscrow['balanceOf(address,uint256)'](userAddress, timestamp);
    expect(await cachedBalance).to.be.eq(await expectedBalance);
  }

  async function expectConsistentUserBalancesUpToTimestamp(user: Account, timestamp: BigNumberish): Promise<void> {
    const userAddress = TypesConverter.toAddress(user);
    const weekTimestamps = getWeekTimestamps(await currentTimestamp());
    for (const weekTimestamp of weekTimestamps) {
      if (weekTimestamp.lt(timestamp)) {
        await expectConsistentUserBalance(user, weekTimestamp);
      } else {
        expect(await feeDistributor.getUserBalanceAtTimestamp(userAddress, weekTimestamp)).to.be.eq(0);
      }
    }
  }

  async function expectConsistentTotalSupply(timestamp: BigNumberish): Promise<void> {
    const cachedSupply = feeDistributor.getTotalSupplyAtTimestamp(timestamp);
    const expectedSupply = votingEscrow['totalSupply(uint256)'](timestamp);
    expect(await cachedSupply).to.be.eq(await expectedSupply);
  }

  async function expectConsistentTotalSuppliesUpToTimestamp(timestamp: BigNumberish): Promise<void> {
    const weekTimestamps = getWeekTimestamps(await currentTimestamp());
    for (const weekTimestamp of weekTimestamps) {
      if (weekTimestamp.lt(timestamp)) {
        await expectConsistentTotalSupply(weekTimestamp);
      } else {
        expect(await feeDistributor.getTotalSupplyAtTimestamp(weekTimestamp)).to.be.eq(0);
      }
    }
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
          await advanceToTimestamp(startTime.add(1));
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
            start = startTime.add(1);
          });

          function testCheckpoint() {
            sharedBeforeEach('advance time to end of period to checkpoint', async () => {
              await advanceToTimestamp(end);
            });

            it('advances the global time cursor to the start of the next week', async () => {
              expectTimestampsMatch(await feeDistributor.getTimeCursor(), startTime);

              const tx = await feeDistributor.checkpoint();

              const txTimestamp = await receiptTimestamp(tx.wait());
              // Add 1 as if the transaction falls exactly on the beginning of the week
              // then we also go to the end of the week as we can read the current balance
              const nextWeek = roundUpTimestamp(txTimestamp + 1);

              expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);
            });

            it('stores the VotingEscrow supply at the start of each week', async () => {
              await feeDistributor.checkpoint();

              await expectConsistentTotalSuppliesUpToTimestamp(end);
            });
          }

          context("when the contract hasn't checkpointed in a small number of weeks", () => {
            sharedBeforeEach('set end timestamp', async () => {
              end = start.add(8 * WEEK + 1);
            });
            testCheckpoint();
          });
        });
      });
    });

    describe('user checkpoint', () => {
      describe('checkpointUser', () => {
        let user: SignerWithAddress;
        let start: BigNumber;
        let end: BigNumber;

        function testCheckpoint(checkpointsPerWeek = 0) {
          let expectFullySynced: boolean;

          sharedBeforeEach('advance time to end of period to checkpoint', async () => {
            const numWeeks = roundDownTimestamp(end).sub(roundDownTimestamp(start)).div(WEEK).toNumber();
            for (let i = 0; i < numWeeks; i++) {
              if (i > 0) {
                await advanceToTimestamp(roundDownTimestamp(start).add(i * WEEK + 1));
              }
              for (let j = 0; j < checkpointsPerWeek; j++) {
                await depositForUser(user, 1);
              }
            }
            await advanceToTimestamp(end);

            const lastCheckpointedEpoch = await feeDistributor.getUserLastEpochCheckpointed(user.address);
            const currentEpoch = await votingEscrow.user_point_epoch(user.address);

            // In order to determine whether we expect the user to be fully checkpointed after a single call we must
            // calculate the expected number of iterations of the for loop for the user to be fully up to date.
            // We can then compare against the limit of iterations before it automatically breaks (50).
            let iterations;
            if (currentEpoch.sub(lastCheckpointedEpoch).lte(20)) {
              // We use an iteration every time we either:
              // a) write a value of the user's balance to storage, or
              // b) move forwards an epoch.
              iterations = numWeeks + checkpointsPerWeek * numWeeks;
            } else {
              // In this case, we skip the checkpoints in the first week as we trigger the binary search shortcut.
              // We then remove another `checkpointsPerWeek` iterations.
              iterations = numWeeks + Math.max(checkpointsPerWeek * (numWeeks - 1), 0);
            }

            expectFullySynced = iterations < 50;
          });

          it("advances the user's time cursor", async () => {
            const userCursorBefore = await feeDistributor.getUserTimeCursor(user.address);

            const tx = await feeDistributor.checkpointUser(user.address);

            if (expectFullySynced) {
              // This is a stronger check to ensure that we're completely up to date.
              const txTimestamp = await receiptTimestamp(tx.wait());
              const nextWeek = roundUpTimestamp(txTimestamp);
              expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), nextWeek);
            } else {
              // If we're not fully syncing then just check that we've managed to progress at least one week.
              const nextWeek = userCursorBefore.add(WEEK);
              expect(await feeDistributor.getUserTimeCursor(user.address)).to.be.gte(nextWeek);
            }
          });

          it('progresses the most recently checkpointed epoch', async () => {
            const currentEpoch = await votingEscrow.user_point_epoch(user.address);
            const previousLastCheckpointedEpoch = await feeDistributor.getUserLastEpochCheckpointed(user.address);

            await feeDistributor.checkpointUser(user.address);

            const newLastCheckpointedEpoch = await feeDistributor.getUserLastEpochCheckpointed(user.address);

            if (previousLastCheckpointedEpoch.eq(currentEpoch) || expectFullySynced) {
              expect(newLastCheckpointedEpoch).to.be.eq(currentEpoch);
            } else {
              expect(newLastCheckpointedEpoch).to.be.gt(previousLastCheckpointedEpoch);
            }
          });

          it("stores the user's balance at the start of each week", async () => {
            const userCursorBefore = await feeDistributor.getUserTimeCursor(user.address);
            expectConsistentUserBalancesUpToTimestamp(user, userCursorBefore);

            await feeDistributor.checkpointUser(user.address);

            const userCursorAfter = await feeDistributor.getUserTimeCursor(user.address);
            expectConsistentUserBalancesUpToTimestamp(user, userCursorAfter);
          });
        }

        context('on first checkpoint', () => {
          context('when startTime has not passed', () => {
            it('reverts', async () => {
              await expect(feeDistributor.checkpointUser(user1.address)).to.be.revertedWith(
                'Fee distribution has not started yet'
              );
            });
          });

          context('when startTime has passed', () => {
            sharedBeforeEach('advance time past startTime', async () => {
              await advanceToTimestamp(startTime.add(1));

              start = await currentTimestamp();
            });

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

        context('on subsequent checkpoints', () => {
          sharedBeforeEach('advance time past startTime and checkpoint', async () => {
            await advanceToTimestamp(startTime.add(1));
            await feeDistributor.checkpointUser(user1.address);
          });

          context('when the user has already been checkpointed', () => {
            let nextWeek: BigNumber;

            sharedBeforeEach('checkpoint contract', async () => {
              // We checkpoint the contract so that the next time
              // we call this function there will be no update to perform.
              const tx = await feeDistributor.checkpointUser(user1.address);
              nextWeek = roundUpTimestamp(await receiptTimestamp(tx.wait()));
            });

            context('when user is fully synced up to present', () => {
              it("doesn't update the user's time cursor", async () => {
                expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);

                await feeDistributor.checkpointUser(user1.address);

                expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);
              });

              it('remains on the most recent user epoch', async () => {
                const currentEpoch = await votingEscrow.user_point_epoch(user1.address);

                // Check that we're on the most recent user epoch already
                const previousLastCheckpointedEpoch = await feeDistributor.getUserLastEpochCheckpointed(user1.address);
                expect(previousLastCheckpointedEpoch).to.be.eq(currentEpoch);

                await feeDistributor.checkpointUser(user1.address);

                const newLastCheckpointedEpoch = await feeDistributor.getUserLastEpochCheckpointed(user1.address);
                expect(newLastCheckpointedEpoch).to.be.eq(currentEpoch);
              });
            });

            context('when more checkpoints are created', () => {
              sharedBeforeEach('create many checkpoints', async () => {
                const NUM_CHECKPOINTS = 25;
                for (let i = 0; i < NUM_CHECKPOINTS; i++) {
                  await depositForUser(user1, 1);
                }
              });

              it("doesn't update the user's time cursor", async () => {
                expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);

                await feeDistributor.checkpointUser(user1.address);

                expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);
              });

              it('progresses the most recently checkpointed epoch', async () => {
                await feeDistributor.checkpointUser(user.address);

                const currentEpoch = await votingEscrow.user_point_epoch(user.address);
                const newLastCheckpointedEpoch = await feeDistributor.getUserLastEpochCheckpointed(user.address);

                expect(newLastCheckpointedEpoch).to.be.eq(currentEpoch);
              });
            });
          });

          context('when the user has not been checkpointed this week', () => {
            sharedBeforeEach('advance time past startTime', async () => {
              await advanceToTimestamp(startTime.add(WEEK).add(1));

              start = await currentTimestamp();
            });

            context("when user hasn't checkpointed in a small number of weeks", () => {
              sharedBeforeEach('set end timestamp', async () => {
                end = start.add(8 * WEEK - 1);
              });

              context('when user locked prior to the beginning of the week', () => {
                sharedBeforeEach('set user', async () => {
                  user = user1;
                });

                context('when the user receives a small number of checkpoints', () => {
                  testCheckpoint(2);
                });

                context('when the user receives enough checkpoints they cannot fully sync', () => {
                  testCheckpoint(10);
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
          tokenAmounts = tokens.map((_, i) => fp(i + 1));
        });

        itCheckpointsTokensCorrectly(() => feeDistributor.checkpointToken(tokens.addresses[0]));
      });

      describe('checkpointTokens', () => {
        sharedBeforeEach('Deploy protocol fee token', async () => {
          tokens = await TokenList.create(['FEE', 'FEE2']);
          tokenAmounts = tokens.map((_, i) => fp(i + 1));
        });

        itCheckpointsTokensCorrectly(() => feeDistributor.checkpointTokens(tokens.addresses));
      });
    });
  });

  describe('claiming', () => {
    let tokens: TokenList;
    let tokenAmounts: BigNumber[];

    const itRevertsBeforeStartTime = (claimTokens: () => Promise<ContractTransaction>) => {
      context('when startTime has not passed', () => {
        it('reverts', async () => {
          await expect(claimTokens()).to.be.revertedWith('Fee distribution has not started yet');
        });
      });
    };

    function itUpdatesCheckpointsCorrectly(
      claimTokens: () => Promise<ContractTransaction>,
      checkpointTypes: ('global' | 'user' | 'token' | 'user-token')[]
    ): void {
      if (checkpointTypes.includes('global')) {
        it('checkpoints the global state', async () => {
          const nextWeek = roundUpTimestamp(await currentTimestamp());
          await claimTokens();

          expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);
        });
      }

      if (checkpointTypes.includes('token')) {
        it('checkpoints the token state', async () => {
          const previousTimeCursors = await Promise.all(
            tokens.addresses.map((token) => feeDistributor.getTokenTimeCursor(token))
          );

          const tx = await claimTokens();
          const txTimestamp = await receiptTimestamp(tx.wait());

          // This replicates the rate limiting of performing token checkpoints in the FeeDistributor contract.
          // If we've already checkpointed the token this week and we're not in the last day of the week then we
          // shouldn't checkpoint the token.
          const expectedTimeCursors = previousTimeCursors.map((prevTimeCursor) => {
            const alreadyCheckpointedThisWeek = roundDownTimestamp(txTimestamp).eq(roundDownTimestamp(prevTimeCursor));
            const nearingEndOfWeek = roundUpTimestamp(txTimestamp).sub(txTimestamp).lt(DAY);

            return alreadyCheckpointedThisWeek && !nearingEndOfWeek ? prevTimeCursor : txTimestamp;
          });

          for (const [i, token] of tokens.addresses.entries()) {
            const tokenTimeCursor = await feeDistributor.getTokenTimeCursor(token);
            expectTimestampsMatch(tokenTimeCursor, expectedTimeCursors[i]);
          }
        });
      }

      if (checkpointTypes.includes('user')) {
        it('checkpoints the user state', async () => {
          const nextWeek = roundUpTimestamp(await currentTimestamp());

          await claimTokens();
          expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);
        });
      }

      if (checkpointTypes.includes('user-token')) {
        it('updates the token time cursor for the user to the latest claimed week', async () => {
          const thisWeek = roundDownTimestamp(await currentTimestamp());

          await claimTokens();
          for (const token of tokens.addresses) {
            expectTimestampsMatch(await feeDistributor.getUserTokenTimeCursor(user1.address, token), thisWeek);
          }
        });
      }
    }

    function itClaimsNothing(
      claimTokens: () => Promise<ContractTransaction>,
      simulateClaimTokens: () => Promise<BigNumber[]>
    ): void {
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
    }

    function itClaimsTokensCorrectly(
      claimTokens: () => Promise<ContractTransaction>,
      simulateClaimTokens: () => Promise<BigNumber[]>
    ): void {
      it('emits a TokensClaimed event', async () => {
        const thisWeek = roundDownTimestamp(await currentTimestamp());

        const tx = await claimTokens();
        for (const [index, token] of tokens.tokens.entries()) {
          const event = expectEvent.inReceipt(await tx.wait(), 'TokensClaimed', {
            user: user1.address,
            token: token.address,
            userTokenTimeCursor: thisWeek,
          });

          expect(event.args.amount).to.be.almostEqual(tokenAmounts[index].div(3));
        }
      });

      it('transfers tokens to the user', async () => {
        await expectBalanceChange(() => claimTokens(), tokens, {
          account: user1.address,
          changes: tokens
            .map((token, i) => ({ [token.symbol]: ['very-near', tokenAmounts[i].div(3)] as Comparison }))
            .reduce((prev, curr) => ({ ...prev, ...curr }), {}),
        });
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
        expect(await simulateClaimTokens()).to.be.almostEqual(tokenAmounts.map((amount) => amount.div(3)));
      });
    }

    describe('claimToken', () => {
      let token: Token;
      sharedBeforeEach('Deploy protocol fee token', async () => {
        tokens = await TokenList.create(['FEE']);
        token = tokens.tokens[0];
        tokenAmounts = tokens.map(() => parseFixed('1', 18));
      });

      context('when performing the first claim', () => {
        itRevertsBeforeStartTime(() => feeDistributor.claimToken(user1.address, token.address));

        context('when startTime has passed', () => {
          sharedBeforeEach('advance time past startTime', async () => {
            await advanceToTimestamp(startTime.add(100));
          });

          itUpdatesCheckpointsCorrectly(() => feeDistributor.claimToken(user1.address, token.address), [
            'global',
            'token',
            'user',
            'user-token',
          ]);

          // Return values from static-calling claimToken need to be converted into array format to standardise test code.
          context('when there are no tokens to distribute to user', () => {
            itClaimsNothing(
              () => feeDistributor.claimToken(user1.address, token.address),
              async () => [await feeDistributor.callStatic.claimToken(user1.address, token.address)]
            );
          });

          context('when there are tokens to distribute to user', () => {
            sharedBeforeEach('send tokens', async () => {
              for (const [index, token] of tokens.tokens.entries()) {
                await token.mint(feeDistributor, tokenAmounts[index]);
              }
              await feeDistributor.checkpointTokens(tokens.addresses);

              // For the week to become claimable we must wait until the next week starts
              const nextWeek = roundUpTimestamp(await currentTimestamp());
              await advanceToTimestamp(nextWeek.add(1));
            });

            itClaimsTokensCorrectly(
              () => feeDistributor.claimToken(user1.address, token.address),
              async () => [await feeDistributor.callStatic.claimToken(user1.address, token.address)]
            );
          });
        });
      });

      context('when performing future claims', () => {
        sharedBeforeEach('perform the first claim', async () => {
          await advanceToTimestamp(startTime.add(1));
          const tx = await feeDistributor.claimToken(user1.address, token.address);
          const txTimestamp = await receiptTimestamp(tx.wait());

          const thisWeek = roundDownTimestamp(txTimestamp);
          const nextWeek = roundUpTimestamp(txTimestamp);

          // Check that the first checkpoint left the FeeDistributor in the expected state.
          expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);
          expectTimestampsMatch(await feeDistributor.getTokenTimeCursor(token.address), txTimestamp);
          expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user1.address), nextWeek);
          expectTimestampsMatch(await feeDistributor.getUserTokenTimeCursor(user1.address, token.address), thisWeek);
        });

        context('when the user has many checkpoints', () => {
          sharedBeforeEach('create many checkpoints', async () => {
            // Creating many checkpoints now would prevent the user from checkpointing startTime+WEEK, which is only
            // claimable at startTime+2*WEEK.

            const NUM_CHECKPOINTS = 100;
            for (let i = 0; i < NUM_CHECKPOINTS; i++) {
              await depositForUser(user1, 1);
            }
            await advanceToTimestamp(startTime.add(WEEK).add(1));
          });

          context('when there are tokens to distribute to user', () => {
            sharedBeforeEach('send tokens', async () => {
              await feeDistributor.checkpointTokens(tokens.addresses);
              for (const [index, token] of tokens.tokens.entries()) {
                await token.mint(feeDistributor, tokenAmounts[index]);
              }
              await feeDistributor.checkpointTokens(tokens.addresses);

              // For the week to become claimable we must wait until the next week starts
              const nextWeek = roundUpTimestamp(await currentTimestamp());
              await advanceToTimestamp(nextWeek.add(1));
            });

            itUpdatesCheckpointsCorrectly(() => feeDistributor.claimToken(user1.address, token.address), [
              'global',
              'user',
              'token',
              'user-token',
            ]);

            itClaimsTokensCorrectly(
              () => feeDistributor.claimToken(user1.address, token.address),
              async () => [await feeDistributor.callStatic.claimToken(user1.address, token.address)]
            );
          });
        });
      });
    });

    describe('claimTokens', () => {
      sharedBeforeEach('Deploy protocol fee token', async () => {
        tokens = await TokenList.create(['FEE', 'FEE2']);
        tokenAmounts = tokens.map((_, i) => fp(i + 1));
      });

      context('when performing the first claim', () => {
        itRevertsBeforeStartTime(() => feeDistributor.claimTokens(user1.address, tokens.addresses));

        context('when startTime has passed', () => {
          sharedBeforeEach('advance time past startTime', async () => {
            await advanceToTimestamp(startTime.add(100));
          });

          itUpdatesCheckpointsCorrectly(() => feeDistributor.claimTokens(user1.address, tokens.addresses), [
            'global',
            'token',
            'user',
            'user-token',
          ]);

          context('when there are no tokens to distribute to user', () => {
            itClaimsNothing(
              () => feeDistributor.claimTokens(user1.address, tokens.addresses),
              () => feeDistributor.callStatic.claimTokens(user1.address, tokens.addresses)
            );
          });

          context('when there are tokens to distribute to user', () => {
            sharedBeforeEach('send tokens', async () => {
              for (const [index, token] of tokens.tokens.entries()) {
                await token.mint(feeDistributor, tokenAmounts[index]);
              }
              await feeDistributor.checkpointTokens(tokens.addresses);

              // For the week to become claimable we must wait until the next week starts
              const nextWeek = roundUpTimestamp(await currentTimestamp());
              await advanceToTimestamp(nextWeek.add(1));
            });

            itClaimsTokensCorrectly(
              () => feeDistributor.claimTokens(user1.address, tokens.addresses),
              () => feeDistributor.callStatic.claimTokens(user1.address, tokens.addresses)
            );

            context('when the array of tokens contains duplicates', () => {
              it('ignores the second occurence of the token address', async () => {
                expect(await feeDistributor.callStatic.claimTokens(user1.address, tokens.addresses)).to.be.almostEqual(
                  tokenAmounts.map((amount) => amount.div(3))
                );
              });
            });
          });
        });
      });
    });

    describe('only caller check', () => {
      let sender: SignerWithAddress;

      function itClaimsCorrectly() {
        it('claimToken does not revert', async () => {
          await expect(feeDistributor.connect(sender).claimToken(user1.address, tokens.addresses[0])).to.not.be
            .reverted;
        });

        it('claimTokens does not revert', async () => {
          await expect(feeDistributor.connect(sender).claimTokens(user1.address, tokens.addresses)).to.not.be.reverted;
        });
      }

      // Minimal setup to be able to call claim methods properly.
      sharedBeforeEach('advance time past startTime', async () => {
        tokens = await TokenList.create(['FEE']);
        await advanceToTimestamp(startTime.add(100));
      });

      context('when disabled', () => {
        context('when the caller is the user', () => {
          beforeEach(() => {
            sender = user1;
          });

          itClaimsCorrectly();
        });

        context('when the caller is other', () => {
          beforeEach(() => {
            sender = other;
          });

          itClaimsCorrectly();
        });
      });

      context('when enabled', () => {
        sharedBeforeEach('enable only caller verification', async () => {
          await feeDistributor.connect(user1).setOnlyCallerCheck(true);
        });

        context('when the caller is the user', () => {
          beforeEach(() => {
            sender = user1;
          });

          itClaimsCorrectly();
        });

        context('when the caller is other', () => {
          beforeEach(() => {
            sender = other;
          });

          it('claimToken reverts', async () => {
            await expect(feeDistributor.connect(other).claimToken(user1.address, tokens.addresses[0])).to.be.reverted;
          });

          it('claimTokens reverts', async () => {
            await expect(feeDistributor.connect(other).claimTokens(user1.address, tokens.addresses)).to.be.reverted;
          });
        });
      });
    });
  });
});
