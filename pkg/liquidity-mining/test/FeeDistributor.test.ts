import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
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

const roundDownTimestamp = (timestamp: BigNumberish): BigNumber => {
  return BigNumber.from(timestamp).div(WEEK).mul(WEEK);
};

const roundUpTimestamp = (timestamp: BigNumberish): BigNumber => {
  return roundDownTimestamp(BigNumber.from(timestamp).add(WEEK).sub(1));
};

describe.only('FeeDistributor', () => {
  let bpt: Token;
  let votingEscrow: Contract;
  let feeDistributor: Contract;

  let startTime: BigNumber;

  let user: SignerWithAddress;

  before('setup signers', async () => {
    [, user] = await ethers.getSigners();
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
      expect(await feeDistributor.getTimeCursor()).to.be.eq(startTime);
    });
  });

  describe('checkpoint', () => {
    context('when startTime has not passed', () => {
      it('does nothing', async () => {
        expect(await feeDistributor.getTimeCursor()).to.be.eq(startTime);
        expect(await feeDistributor.getTotalSupplyAtTimestamp(startTime)).to.be.eq(0);

        await feeDistributor.checkpoint();

        expect(await feeDistributor.getTimeCursor()).to.be.eq(startTime);
        expect(await feeDistributor.getTotalSupplyAtTimestamp(startTime)).to.be.eq(0);
      });
    });

    context('when startTime has passed', () => {
      sharedBeforeEach('advance time past startTime', async () => {
        await advanceToTimestamp(startTime.add(100));
      });

      it('advances the global time cursor', async () => {
        const nextWeek = roundUpTimestamp(await currentTimestamp());

        expect(await feeDistributor.getTimeCursor()).to.be.eq(startTime);

        await feeDistributor.checkpoint();

        expect(await feeDistributor.getTimeCursor()).to.be.eq(nextWeek);
      });

      it('stores the VotingEscrow supply at the start of the week', async () => {
        expect(await feeDistributor.getTotalSupplyAtTimestamp(startTime)).to.be.eq(0);

        await feeDistributor.checkpoint();

        await expectConsistentTotalSupply(startTime);
      });
    });
  });

  describe('checkpointUser', () => {
    context('when startTime has not passed', () => {
      it('does not advance the user time cursor past startTime', async () => {
        expect(await feeDistributor.getUserTimeCursor(user.address)).to.be.eq(0);

        await feeDistributor.checkpointUser(user.address);

        expect(await feeDistributor.getUserTimeCursor(user.address)).to.be.eq(startTime);

        await feeDistributor.checkpointUser(user.address);

        expect(await feeDistributor.getUserTimeCursor(user.address)).to.be.eq(startTime);
      });

      it("does not write a value for user's balance at startTime", async () => {
        expect(await feeDistributor.getUserBalanceAtTimestamp(user.address, startTime)).to.be.eq(0);

        await feeDistributor.checkpointUser(user.address);

        expect(await feeDistributor.getUserBalanceAtTimestamp(user.address, startTime)).to.be.eq(0);
      });
    });

    context('when startTime has passed', () => {
      sharedBeforeEach('advance time past startTime', async () => {
        await advanceToTimestamp(startTime.add(100));
      });

      it('advances the global time cursor', async () => {
        const nextWeek = roundUpTimestamp(await currentTimestamp());

        expect(await feeDistributor.getUserTimeCursor(user.address)).to.be.eq(0);

        await feeDistributor.checkpointUser(user.address);

        expect(await feeDistributor.getUserTimeCursor(user.address)).to.be.eq(nextWeek);
      });

      it("stores the user's balance at the start of the week", async () => {
        expect(await feeDistributor.getUserBalanceAtTimestamp(user.address, startTime)).to.be.eq(0);

        await feeDistributor.checkpointUser(user.address);

        await expectConsistentUserBalance(user, startTime);
      });
    });
  });
});
