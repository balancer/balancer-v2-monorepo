import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { parseFixed } from '@ethersproject/bignumber';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { expect } from 'chai';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { ANY_ADDRESS, ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

describe('ChildChainGaugeTokenAdder', () => {
  let vault: Vault;
  let adaptor: Contract;

  let token: Token;
  let balToken: Token;

  let gauge: Contract;
  let streamer: Contract;

  let gaugeTokenAdder: Contract;

  let admin: SignerWithAddress, distributor: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, distributor] = await ethers.getSigners();
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

    gaugeTokenAdder = await deploy('ChildChainGaugeTokenAdder', { args: [factory.address, adaptor.address] });
  });

  sharedBeforeEach('set up permissions', async () => {
    // Allow the ChildChainGaugeTokenAdder to call the relevant functions on the AuthorizerAdaptor.
    const addRewardRole = await actionId(adaptor, 'add_reward', streamer.interface);
    const setRewardsRole = await actionId(adaptor, 'set_rewards', gauge.interface);

    await vault.grantPermissionsGlobally([addRewardRole, setRewardsRole], gaugeTokenAdder);
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await gaugeTokenAdder.getVault()).to.be.eq(vault.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await gaugeTokenAdder.getAuthorizer()).to.equal(vault.authorizer?.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault.instance, 'setAuthorizer');
      await vault.grantPermissionsGlobally([action], admin.address);

      await vault.instance.connect(admin).setAuthorizer(ANY_ADDRESS);

      expect(await gaugeTokenAdder.getAuthorizer()).to.equal(ANY_ADDRESS);
    });
  });

  describe('addTokenToGauge', () => {
    let newRewardToken: Token;

    sharedBeforeEach('deploy token', async () => {
      newRewardToken = await Token.create({ symbol: 'REWARD' });
    });

    sharedBeforeEach('grant permission to add new tokens', async () => {
      const addTokenToGaugeRole = await actionId(gaugeTokenAdder, 'addTokenToGauge');

      await vault.grantPermissionsGlobally([addTokenToGaugeRole], admin);
    });

    context('when interacting with a gauge from the expected factory', () => {
      it('adds the token to the streamer', async () => {
        const tx = await gaugeTokenAdder
          .connect(admin)
          .addTokenToGauge(gauge.address, newRewardToken.address, distributor.address);
        const receipt = await tx.wait();

        expectEvent.inIndirectReceipt(receipt, streamer.interface, 'RewardDistributorUpdated', {
          reward_token: newRewardToken.address,
          distributor: distributor.address,
        });
        expectEvent.inIndirectReceipt(receipt, streamer.interface, 'RewardDurationUpdated', {
          reward_token: newRewardToken.address,
          duration: WEEK,
        });
      });

      it('leaves the streamer and gauge in a consistent state', async () => {
        await gaugeTokenAdder
          .connect(admin)
          .addTokenToGauge(gauge.address, newRewardToken.address, distributor.address);

        const MAX_REWARDS = 8;
        for (let i = 0; i < MAX_REWARDS; ++i) {
          const streamerRewardToken = await streamer.reward_tokens(i);
          const gaugeRewardToken = await gauge.reward_tokens(i);

          expect(streamerRewardToken).to.be.eq(gaugeRewardToken);
        }
      });

      context('when next claiming from the gauge', () => {
        const rewardAmount = parseFixed('1', 18);

        sharedBeforeEach('start reward distribution of new token', async () => {
          await gaugeTokenAdder
            .connect(admin)
            .addTokenToGauge(gauge.address, newRewardToken.address, distributor.address);

          await newRewardToken.mint(streamer.address, rewardAmount);
          await streamer.connect(distributor).notify_reward_amount(newRewardToken.address);
          await advanceTime(DAY);
        });

        it('pulls the new token to the gauge', async () => {
          const expectedRewardAmount = rewardAmount.mul(DAY).div(WEEK);

          await expectBalanceChange(() => streamer.get_reward(), new TokenList([newRewardToken]), [
            { account: streamer, changes: { [newRewardToken.symbol]: ['near', expectedRewardAmount.mul(-1)] } },
            { account: gauge, changes: { [newRewardToken.symbol]: ['near', expectedRewardAmount] } },
          ]);
        });
      });

      context('when interacting with a gauge not from the expected factory', () => {
        it('reverts', async () => {
          await expect(
            gaugeTokenAdder.connect(admin).addTokenToGauge(ANY_ADDRESS, newRewardToken.address, distributor.address)
          ).to.be.revertedWith('Invalid gauge');
        });
      });

      context("when the gauge's streamer has been changed from the original", () => {
        sharedBeforeEach("change the gauge's streamer", async () => {
          const addTokenToGaugeRole = await actionId(adaptor, 'set_rewards', gauge.interface);
          await vault.grantPermissionsGlobally([addTokenToGaugeRole], admin);

          await adaptor
            .connect(admin)
            .performAction(
              gauge.address,
              gauge.interface.encodeFunctionData('set_rewards', [
                ZERO_ADDRESS,
                ZERO_BYTES32,
                [
                  balToken.address,
                  ZERO_ADDRESS,
                  ZERO_ADDRESS,
                  ZERO_ADDRESS,
                  ZERO_ADDRESS,
                  ZERO_ADDRESS,
                  ZERO_ADDRESS,
                  ZERO_ADDRESS,
                ],
              ])
            );
        });

        it('reverts', async () => {
          await expect(
            gaugeTokenAdder.connect(admin).addTokenToGauge(gauge.address, newRewardToken.address, distributor.address)
          ).to.be.revertedWith('Not original gauge streamer');
        });
      });
    });
  });
});
