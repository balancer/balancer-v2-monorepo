import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('ChildChainStreamer', () => {
  let vault: Vault;
  let adaptor: Contract;

  let balToken: Token;

  let streamer: Contract;

  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });

    balToken = await Token.create({ symbol: 'BAL' });

    const gaugeImplementation = await deploy('RewardsOnlyGauge', {
      args: [balToken.address, vault.address, adaptor.address],
    });
    const streamerImplementation = await deploy('ChildChainStreamer', { args: [balToken.address, adaptor.address] });

    const factory = await deploy('ChildChainLiquidityGaugeFactory', {
      args: [gaugeImplementation.address, streamerImplementation.address],
    });

    const token = await Token.create({ symbol: 'BPT' });
    await factory.create(token.address);
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

      expectEvent.inIndirectReceipt(await tx.wait(), balToken.instance.interface, 'Transfer', {
        from: streamer.address,
        to: other.address,
        value: tokenBalanceBefore,
      });
    });
  });
});
