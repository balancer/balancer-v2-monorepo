import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, BigNumber, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, HOUR, receiptTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { parseFixed } from '@ethersproject/bignumber';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';

describe('ChildChainGaugeRewardHelper', () => {
  const rewardAmount = parseFixed('1', 18);

  let vault: Vault;
  let adaptor: Contract;

  let balToken: Token;
  let tokens: TokenList;

  let gaugeOne: Contract;
  let streamerOne: Contract;
  let gaugeOneStartTime: BigNumberish;

  let gaugeTwo: Contract;
  let streamerTwo: Contract;
  let gaugeTwoStartTime: BigNumberish;

  let gaugeHelper: Contract;

  let admin: SignerWithAddress, distributor: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, distributor, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });

    tokens = await TokenList.create([{ symbol: 'BPT' }, { symbol: 'BPT2' }]);
    balToken = await Token.create({ symbol: 'BAL' });

    const gaugeImplementation = await deploy('RewardsOnlyGauge', {
      args: [balToken.address, vault.address, adaptor.address],
    });
    const streamerImplementation = await deploy('ChildChainStreamer', { args: [balToken.address, adaptor.address] });

    const factory = await deploy('ChildChainLiquidityGaugeFactory', {
      args: [gaugeImplementation.address, streamerImplementation.address],
    });

    await factory.create(tokens.addresses[0]);

    gaugeOne = await deployedAt('RewardsOnlyGauge', await factory.getPoolGauge(tokens.addresses[0]));
    streamerOne = await deployedAt('ChildChainStreamer', await factory.getPoolStreamer(tokens.addresses[0]));

    await factory.create(tokens.addresses[1]);
    gaugeTwo = await deployedAt('RewardsOnlyGauge', await factory.getPoolGauge(tokens.addresses[1]));
    streamerTwo = await deployedAt('ChildChainStreamer', await factory.getPoolStreamer(tokens.addresses[1]));

    gaugeHelper = await deploy('ChildChainGaugeRewardHelper');
  });

  sharedBeforeEach('stake into gauge', async () => {
    await tokens.mint({ to: user });
    await tokens.approve([
      { to: gaugeOne, from: user },
      { to: gaugeTwo, from: user },
    ]);

    await gaugeOne.connect(user)['deposit(uint256)'](rewardAmount);
    await gaugeTwo.connect(user)['deposit(uint256)'](rewardAmount);
  });

  sharedBeforeEach('set up distributor on streamer', async () => {
    const setDistributorActionId = await actionId(adaptor, 'set_reward_distributor', streamerOne.interface);
    await vault.grantPermissionsGlobally([setDistributorActionId], admin);

    const calldata = streamerOne.interface.encodeFunctionData('set_reward_distributor', [
      balToken.address,
      distributor.address,
    ]);
    await adaptor.connect(admin).performAction(streamerOne.address, calldata);
    await adaptor.connect(admin).performAction(streamerTwo.address, calldata);
  });

  sharedBeforeEach('send tokens to streamer', async () => {
    await balToken.mint(streamerOne.address, rewardAmount);
    const tx1 = await streamerOne.connect(distributor).notify_reward_amount(balToken.address);
    gaugeOneStartTime = await receiptTimestamp(tx1.wait());

    await balToken.mint(streamerTwo.address, rewardAmount);
    const tx2 = await streamerTwo.connect(distributor).notify_reward_amount(balToken.address);
    gaugeTwoStartTime = await receiptTimestamp(tx2.wait());
  });

  describe('claimRewardsFromGauge', () => {
    context('when the gauge has not claimed tokens from streamer recently', () => {
      it('claims tokens from the streamer', async () => {
        const tx = await gaugeHelper.claimRewardsFromGauge(gaugeOne.address, user.address);
        expectTransferEvent(await tx.wait(), { from: streamerOne.address, to: gaugeOne.address }, balToken);
      });
    });

    context('when the gauge has claimed tokens from streamer recently', () => {
      sharedBeforeEach('send tokens to streamer', async () => {
        await gaugeOne['claim_rewards(address)'](other.address);

        await advanceTime(HOUR / 2);
        // Ensure that we're still in the rate limiting period.
        const now = await currentTimestamp();
        const lastClaimTime = await gaugeOne.last_claim();
        expect(now.sub(lastClaimTime)).to.be.lt(HOUR);
      });

      it('claims more tokens from the streamer', async () => {
        const existingRewards = await balToken.balanceOf(gaugeOne);
        const reportedPendingRewards = await gaugeHelper.callStatic.getPendingRewards(
          gaugeOne.address,
          user.address,
          balToken.address
        );

        const tx = await gaugeHelper.claimRewardsFromGauge(gaugeOne.address, user.address);

        const claimTimestamp = await receiptTimestamp(tx);
        const totalCumulativeRewards = rewardAmount.mul(bn(claimTimestamp).sub(gaugeOneStartTime)).div(WEEK);
        const expectedNewRewardsAmount = totalCumulativeRewards.sub(existingRewards);

        expect(reportedPendingRewards).to.be.almostEqual(totalCumulativeRewards);

        const {
          args: { value: newRewardsAmount },
        } = expectTransferEvent(await tx.wait(), { from: streamerOne.address, to: gaugeOne.address }, balToken);
        expect(newRewardsAmount).to.be.almostEqual(expectedNewRewardsAmount);
      });
    });
  });

  describe('claimRewardsFromGauges', () => {
    context('when the gauge has not claimed tokens from streamer recently', () => {
      it('claims tokens from the streamer', async () => {
        const tx = await gaugeHelper.claimRewardsFromGauges([gaugeOne.address, gaugeTwo.address], user.address);
        expectTransferEvent(await tx.wait(), { from: streamerOne.address, to: gaugeOne.address }, balToken);
        expectTransferEvent(await tx.wait(), { from: streamerTwo.address, to: gaugeTwo.address }, balToken);
      });
    });

    context('when the gauge has claimed tokens from streamer recently', () => {
      sharedBeforeEach('send tokens to streamer', async () => {
        await gaugeOne['claim_rewards(address)'](other.address);
        await gaugeTwo['claim_rewards(address)'](other.address);

        await advanceTime(HOUR / 2);

        // Ensure that we're still in the rate limiting period.
        const now = await currentTimestamp();
        const lastClaimTime = await gaugeOne.last_claim();
        expect(now.sub(lastClaimTime)).to.be.lt(HOUR);
      });

      it('claims more tokens from the streamer', async () => {
        const existingRewardsOne = await balToken.balanceOf(gaugeOne);
        const existingRewardsTwo = await balToken.balanceOf(gaugeOne);

        const reportedPendingRewards = (
          await Promise.all(
            [gaugeOne, gaugeTwo].map((gauge) =>
              gaugeHelper.callStatic.getPendingRewards(gauge.address, user.address, balToken.address)
            )
          )
        ).reduce((prev: BigNumber, curr: BigNumber) => curr.add(prev), bn(0));

        const tx = await gaugeHelper.claimRewardsFromGauges([gaugeOne.address, gaugeTwo.address], user.address);
        const claimTimestamp = await receiptTimestamp(tx);

        const totalCumulativeRewardsOne = rewardAmount.mul(bn(claimTimestamp).sub(gaugeOneStartTime)).div(WEEK);
        const expectedNewRewardsAmountOne = totalCumulativeRewardsOne.sub(existingRewardsOne);

        const {
          args: { value: newRewardsAmountOne },
        } = expectTransferEvent(await tx.wait(), { from: streamerOne.address, to: gaugeOne.address }, balToken);
        expect(newRewardsAmountOne).to.be.almostEqual(expectedNewRewardsAmountOne);

        const totalCumulativeRewardsTwo = rewardAmount.mul(bn(claimTimestamp).sub(gaugeTwoStartTime)).div(WEEK);
        const expectedNewRewardsAmountTwo = totalCumulativeRewardsTwo.sub(existingRewardsTwo);

        const {
          args: { value: newRewardsAmountTwo },
        } = expectTransferEvent(await tx.wait(), { from: streamerTwo.address, to: gaugeTwo.address }, balToken);
        expect(newRewardsAmountTwo).to.be.almostEqual(expectedNewRewardsAmountTwo);

        expect(reportedPendingRewards).to.be.almostEqual(totalCumulativeRewardsOne.add(totalCumulativeRewardsTwo));
      });
    });
  });
});
