import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceToTimestamp, currentTimestamp, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { parseFixed } from '@ethersproject/bignumber';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

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

async function getReceiptTimestamp(receipt: ContractReceipt | Promise<ContractReceipt>): Promise<number> {
  const blockHash = (await receipt).blockHash;
  const block = await ethers.provider.getBlock(blockHash);
  return block.timestamp;
}

function expectTimestampsMatch(timestamp: BigNumberish, expectedTimestamp: BigNumberish): void {
  const weekNumber = BigNumber.from(timestamp).div(WEEK).toNumber();
  const expectedWeekNumber = BigNumber.from(expectedTimestamp).div(WEEK).toNumber();
  expect(timestamp, `Timestamp is ${weekNumber - expectedWeekNumber} weeks off`).to.be.eq(expectedTimestamp);
}

describe.only('FeeDistributor', () => {
  let bpt: Token;
  let votingEscrow: Contract;
  let feeDistributor: Contract;

  let startTime: BigNumber;

  let user: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy fee distributor', async () => {
    bpt = await Token.create('BPT');
    votingEscrow = await deploy('VotingEscrow', {
      args: [bpt.address, 'Vote Escrowed Balancer BPT', 'veBAL', ANY_ADDRESS],
    });

    // startTime is rounded up to the beginning of next week
    startTime = roundUpTimestamp(Math.floor(new Date().getTime() / 1000));
    feeDistributor = await deploy('FeeDistributor', {
      args: [votingEscrow.address, startTime],
    });
  });

  sharedBeforeEach('lock BPT into VotingEscrow', async () => {
    const bptAmount = parseFixed('1', 18);
    await bpt.mint(user, bptAmount);
    await bpt.approve(votingEscrow, bptAmount, { from: user });

    const lockTimestamp = Math.floor(new Date().getTime() / 1000) + 365 * DAY;

    await votingEscrow.connect(user).create_lock(bptAmount, lockTimestamp);

    await bpt.mint(other, bptAmount);
    await bpt.approve(votingEscrow, bptAmount, { from: other });
    await votingEscrow.connect(other).create_lock(bptAmount, lockTimestamp);

    expect(await votingEscrow['balanceOf(address)'](user.address)).to.be.gt(0, 'zero veBAL balance');
    expect(await votingEscrow['totalSupply()']()).to.be.gt(0, 'zero veBAL supply');
  });

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

  describe('checkpoint', () => {
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
          nextWeek = roundUpTimestamp(await getReceiptTimestamp(tx.wait()));
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
            checkpointTimestamps = Array.from({ length: numWeeks }, (_, i) => roundDownTimestamp(start).add(i * WEEK));
            await advanceToTimestamp(end);
          });

          it('advances the global time cursor to the start of the next week', async () => {
            expectTimestampsMatch(await feeDistributor.getTimeCursor(), start);

            const tx = await feeDistributor.checkpoint();

            const txTimestamp = await getReceiptTimestamp(tx.wait());
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

  describe('checkpointUser', () => {
    context('when startTime has not passed', () => {
      it('does not advance the user time cursor past startTime', async () => {
        expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), 0);

        await feeDistributor.checkpointUser(user.address);

        expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), startTime);

        await feeDistributor.checkpointUser(user.address);

        expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), startTime);
      });

      it("does not write a value for user's balance at startTime", async () => {
        expectTimestampsMatch(await feeDistributor.getUserBalanceAtTimestamp(user.address, startTime), 0);

        await feeDistributor.checkpointUser(user.address);

        expectTimestampsMatch(await feeDistributor.getUserBalanceAtTimestamp(user.address, startTime), 0);
      });
    });

    context('when startTime has passed', () => {
      context('when the user has already been checkpointed', () => {
        let nextWeek: BigNumber;

        sharedBeforeEach('checkpoint contract', async () => {
          // We checkpoint the contract so that the next time
          // we call this function there will be no update to perform.
          const tx = await feeDistributor.checkpointUser(user.address);
          nextWeek = roundUpTimestamp(await getReceiptTimestamp(tx.wait()));
        });

        it('nothing happens', async () => {
          expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), nextWeek);

          await feeDistributor.checkpointUser(user.address);

          expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), nextWeek);
        });
      });

      context('when the user has not been checkpointed this week', () => {
        let start: BigNumber;
        let end: BigNumber;

        sharedBeforeEach('advance time past startTime', async () => {
          await advanceToTimestamp(startTime);

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
            checkpointTimestamps = Array.from({ length: numWeeks }, (_, i) => roundDownTimestamp(start).add(i * WEEK));
            await advanceToTimestamp(end);
          });

          it("advances the user's time cursor to the start of the next week", async () => {
            expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), 0);

            const tx = await feeDistributor.checkpointUser(user.address);

            const txTimestamp = await getReceiptTimestamp(tx.wait());
            // Add 1 as if the transaction falls exactly on the beginning of the week
            // then we also go to the end of the week as we can read the current balance
            const nextWeek = roundUpTimestamp(txTimestamp + 1);

            expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), nextWeek);
          });

          it("stores the user's balance at the start of each week", async () => {
            for (let i = 0; i < numWeeks; i++) {
              expect(await feeDistributor.getUserBalanceAtTimestamp(user.address, checkpointTimestamps[i])).to.be.eq(0);
            }

            await feeDistributor.checkpointUser(user.address);

            for (let i = 0; i < numWeeks; i++) {
              await expectConsistentUserBalance(user, checkpointTimestamps[i]);
            }
          });
        }

        context("when user hasn't checkpointed in a small number of weeks", () => {
          sharedBeforeEach('set end timestamp', async () => {
            //
            end = start.add(8 * WEEK - 1);
          });
          testCheckpoint();
        });
      });
    });
  });

  describe('checkpointToken', () => {
    let token: Token;
    const tokensAmount = parseFixed('1', 18);

    sharedBeforeEach('Deploy protocol fee token', async () => {
      token = await Token.create('FEE');
    });

    context('when startTime has not passed', () => {
      it('reverts', async () => {
        await expect(feeDistributor.checkpointToken(ANY_ADDRESS)).to.be.revertedWith(
          'Fee distribution has not started yet'
        );
      });
    });

    context('when startTime has passed', () => {
      sharedBeforeEach('advance time past startTime', async () => {
        await advanceToTimestamp(startTime.add(100));
      });

      it("updates the token's time cursor to the current timestamp", async () => {
        const tx = await feeDistributor.checkpointToken(token.address);

        const tokenTimeCursor = await feeDistributor.getTokenTimeCursor(token.address);
        const txTimestamp = await getReceiptTimestamp(tx.wait());
        expectTimestampsMatch(tokenTimeCursor, txTimestamp);
      });

      context("when FeeDistributor hasn't received new tokens", () => {
        sharedBeforeEach('send tokens and checkpoint', async () => {
          await token.mint(feeDistributor, tokensAmount);
          await feeDistributor.checkpointToken(token.address);
        });

        it('maintains the same cached balance', async () => {
          const expectedTokenLastBalance = await feeDistributor.getTokenLastBalance(token.address);
          await feeDistributor.checkpointToken(token.address);

          expect(await feeDistributor.getTokenLastBalance(token.address)).to.be.eq(expectedTokenLastBalance);
        });
      });

      context('when FeeDistributor has received new tokens', () => {
        sharedBeforeEach('send tokens', async () => {
          await token.mint(feeDistributor, tokensAmount);
        });

        it('updates the cached balance by the amount of new tokens received', async () => {
          const previousTokenLastBalance = await feeDistributor.getTokenLastBalance(token.address);
          await feeDistributor.checkpointToken(token.address);
          const newTokenLastBalance = await feeDistributor.getTokenLastBalance(token.address);

          expect(newTokenLastBalance.sub(previousTokenLastBalance)).to.be.eq(tokensAmount);
        });
      });
    });
  });

  describe('claimToken', () => {
    let token: Token;
    const tokensAmount = parseFixed('1', 18);

    sharedBeforeEach('Deploy protocol fee token', async () => {
      token = await Token.create('FEE');
    });

    context('when startTime has not passed', () => {
      it('reverts', async () => {
        await expect(feeDistributor.claimToken(user.address, ANY_ADDRESS)).to.be.revertedWith(
          'Fee distribution has not started yet'
        );
      });
    });

    context('when startTime has passed', () => {
      sharedBeforeEach('advance time past startTime', async () => {
        await advanceToTimestamp(startTime.add(100));
      });

      it('checkpoints the global, token and user state', async () => {
        const nextWeek = roundUpTimestamp(await currentTimestamp());
        const tx = await feeDistributor.claimToken(user.address, token.address);

        // Global
        expectTimestampsMatch(await feeDistributor.getTimeCursor(), nextWeek);

        // Token
        // This only works as it is the first token checkpoint. Calls for the next day won't checkpoint
        const tokenTimeCursor = await feeDistributor.getTokenTimeCursor(token.address);
        const txTimestamp = await getReceiptTimestamp(tx.wait());
        expectTimestampsMatch(tokenTimeCursor, txTimestamp);

        // User
        expectTimestampsMatch(await feeDistributor.getUserTimeCursor(user.address), nextWeek);
      });

      it('updates the token time cursor for the user to the latest claimed week', async () => {
        const thisWeek = roundDownTimestamp(await currentTimestamp());

        await feeDistributor.claimToken(user.address, token.address);
        expectTimestampsMatch(await feeDistributor.getUserTokenTimeCursor(user.address, token.address), thisWeek);
      });

      context('when there are no tokens to distribute to user', () => {
        it("doesn't emit a TokensClaimed event", async () => {
          const tx = await feeDistributor.checkpointToken(token.address);
          expectEvent.notEmitted(await tx.wait(), 'TokensClaimed');
        });

        it('maintains the same cached balance', async () => {
          const expectedTokenLastBalance = await feeDistributor.getTokenLastBalance(token.address);
          await feeDistributor.checkpointToken(token.address);

          expect(await feeDistributor.getTokenLastBalance(token.address)).to.be.eq(expectedTokenLastBalance);
        });

        it('returns zero', async () => {
          expect(await feeDistributor.callStatic.claimToken(user.address, token.address)).to.be.eq(0);
        });
      });

      context('when there are tokens to distribute to user', () => {
        sharedBeforeEach('send tokens', async () => {
          await token.mint(feeDistributor, tokensAmount);
          await feeDistributor.checkpointToken(token.address);

          // For the week to become claimable we must wait until the next week starts
          await advanceToNextWeek();
        });

        it('emits a TokensClaimed event', async () => {
          const thisWeek = roundDownTimestamp(await currentTimestamp());

          const tx = await feeDistributor.claimToken(user.address, token.address);
          expectEvent.inReceipt(await tx.wait(), 'TokensClaimed', {
            user: user.address,
            token: token.address,
            amount: tokensAmount.div(2),
            userTokenTimeCursor: thisWeek,
          });
        });

        it('subtracts the number of tokens claimed from the cached balance', async () => {
          const previousTokenLastBalance = await feeDistributor.getTokenLastBalance(token.address);
          const tx = await feeDistributor.claimToken(user.address, token.address);
          const newTokenLastBalance = await feeDistributor.getTokenLastBalance(token.address);

          const {
            args: { amount },
          } = expectEvent.inReceipt(await tx.wait(), 'TokensClaimed', {
            user: user.address,
            token: token.address,
          });
          expect(newTokenLastBalance).to.be.eq(previousTokenLastBalance.sub(amount));
        });

        it('returns the amount of tokens claimed', async () => {
          expect(await feeDistributor.callStatic.claimToken(user.address, token.address)).to.be.eq(tokensAmount.div(2));
        });
      });
    });
  });
});
