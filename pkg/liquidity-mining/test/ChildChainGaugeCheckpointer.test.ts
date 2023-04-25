import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('ChildChainGaugeCheckpointer', () => {
  let gaugeFactory: Contract;
  let gauge1: Contract;
  let gauge2: Contract;
  let checkpointer: Contract;
  let admin: SignerWithAddress, user1: SignerWithAddress, other: SignerWithAddress;
  let registry: Contract;

  before('setup signers', async () => {
    [, admin, user1, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy gauge ChildChainGaugeCheckpointer', async () => {
    const vault = await Vault.create();
    const balToken = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });

    const pseudoMinter = await deploy('L2BalancerPseudoMinter', { args: [vault.address, balToken.address] });

    gaugeFactory = await deploy('MockChildChainGaugeFactory', {});

    registry = await deploy('ChildChainGaugeRegistry', {
      args: [vault.address, pseudoMinter.address, gaugeFactory.address],
    });

    await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin.address);
    await vault.grantPermissionGlobally(await actionId(registry, 'addGauge'), admin.address);
    await vault.grantPermissionGlobally(await actionId(registry, 'removeGauge'), admin.address);

    await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);

    gauge1 = await deploy('MockChildChainGauge', { args: ['test'] });
    await gauge1.setMockFactory(gaugeFactory.address);
    gauge2 = await deploy('MockChildChainGauge', { args: ['test'] });
    await gauge2.setMockFactory(gaugeFactory.address);

    await registry.connect(admin).addGauge(gauge1.address);
    await registry.connect(admin).addGauge(gauge2.address);

    checkpointer = await deploy('ChildChainGaugeCheckpointer', {
      args: [registry.address],
    });
  });

  describe('onVeBalBridged', () => {
    it('calls user_checkpoint on every gauge in the registry', async () => {
      const tx = await checkpointer.connect(other).onVeBalBridged(user1.address);

      for (const gauge of [gauge1, gauge2]) {
        await expectEvent.inIndirectReceipt(await tx.wait(), gauge.interface, 'UserCheckpoint', {
          user: user1.address,
        });
      }
    });
  });
});
