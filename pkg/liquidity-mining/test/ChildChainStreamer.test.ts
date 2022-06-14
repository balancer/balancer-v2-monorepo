import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { parseFixed } from '@ethersproject/bignumber';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, DAY, receiptTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { expect } from 'chai';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';

describe('ChildChainStreamer', () => {
  let vault: Vault;
  let adaptor: Contract;

  let token: Token;
  let balToken: Token;

  let gauge: Contract;
  let streamer: Contract;

  let admin: SignerWithAddress, distributor: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, distributor, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });

    token = await Token.create({ symbol: 'BPT' });
    balToken = await Token.create({ symbol: 'BAL' });

    const gaugeImplementation = await deploy('RewardsOnlyGauge', {
      args: [balToken.address, vault.address, adaptor.address],
    });
    const streamerImplementation = await deploy('ChildChainStreamer', { args: [balToken.address, adaptor.address] });

    const factory = await deploy('ChildChainLiquidityGaugeFactory', {
      args: [gaugeImplementation.address, streamerImplementation.address],
    });

    await factory.create(token.address);

    gauge = await deployedAt('RewardsOnlyGauge', await factory.getPoolGauge(token.address));
    streamer = await deployedAt('ChildChainStreamer', await factory.getPoolStreamer(token.address));
  });

  describe('remove_reward', () => {
    sharedBeforeEach('send tokens to streamer', async () => {
      await balToken.mint(streamer, 100);

      const removeRewardRole = await actionId(adaptor, 'remove_reward', streamer.interface);
      await vault.grantPermissionsGlobally([removeRewardRole], admin);
    });

    it('allows tokens to be recovered', async () => {
      const tokenBalanceBefore = await balToken.balanceOf(streamer);
      const tx = await adaptor
        .connect(admin)
        .performAction(
          streamer.address,
          streamer.interface.encodeFunctionData('remove_reward', [balToken.address, other.address])
        );

      expectTransferEvent(
        await tx.wait(),
        {
          from: streamer.address,
          to: other.address,
          value: tokenBalanceBefore,
        },
        balToken
      );
    });
  });

  describe('claim_rewards', () => {
    const rewardAmount = parseFixed('1', 18);

    sharedBeforeEach('set up distributor on streamer', async () => {
      const setDistributorActionId = await actionId(adaptor, 'set_reward_distributor', streamer.interface);
      await vault.grantPermissionsGlobally([setDistributorActionId], admin);

      const calldata = streamer.interface.encodeFunctionData('set_reward_distributor', [
        balToken.address,
        distributor.address,
      ]);
      await adaptor.connect(admin).performAction(streamer.address, calldata);
    });

    function itUpdatesTimestamp() {
      it('updates last update time', async () => {
        const tx = await streamer.get_reward();
        const lastUpdateTime = await streamer.last_update_time();

        expect(lastUpdateTime).to.be.eq(await receiptTimestamp(tx.wait()));
      });
    }

    sharedBeforeEach('send tokens to streamer', async () => {
      await balToken.mint(streamer.address, rewardAmount);
    });

    context('before reward period', () => {
      it("doesn't transfer any tokens", async () => {
        const tx = await streamer.get_reward();
        const receipt = await tx.wait();

        expectEvent.notEmitted(receipt, 'Transfer');
      });

      itUpdatesTimestamp();
    });

    context('during reward period', () => {
      sharedBeforeEach('start reward period', async () => {
        await streamer.connect(distributor).notify_reward_amount(balToken.address);
        await advanceTime(DAY);
      });

      it('transfers the expected number of tokens', async () => {
        const expectedRewardAmount = rewardAmount.mul(DAY).div(WEEK);

        await expectBalanceChange(() => streamer.get_reward(), new TokenList([balToken]), [
          { account: streamer, changes: { BAL: ['near', expectedRewardAmount.mul(-1)] } },
          { account: gauge, changes: { BAL: ['near', expectedRewardAmount] } },
        ]);
      });

      itUpdatesTimestamp();
    });

    context('after reward period', () => {
      sharedBeforeEach('start reward period', async () => {
        await streamer.connect(distributor).notify_reward_amount(balToken.address);
        await advanceTime(WEEK);
      });

      it('transfers the expected number of tokens', async () => {
        // We need to account for rounding errors for rewards per second
        const expectedRewardAmount = rewardAmount.div(WEEK).mul(WEEK);
        await expectBalanceChange(() => streamer.get_reward(), new TokenList([balToken]), [
          { account: streamer, changes: { BAL: expectedRewardAmount.mul(-1) } },
          { account: gauge, changes: { BAL: expectedRewardAmount } },
        ]);
      });

      itUpdatesTimestamp();
    });
  });
});
