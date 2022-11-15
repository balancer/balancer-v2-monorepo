import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('PoolRecoveryEnabler', function () {
  let vault: Vault;

  let admin: SignerWithAddress, operator: SignerWithAddress;

  before(async () => {
    [, admin, operator] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    vault = await Vault.create({ admin });
  });

  async function expectFactories(enabler: Contract, expectedFactories: Array<string>): Promise<void> {
    expect(await enabler.getFactoryCount()).to.equal(expectedFactories.length);
    for (let i = 0; i < expectedFactories.length; ++i) {
      expect(await enabler.getFactoryAt(i)).to.equal(expectedFactories[i]);
    }
  }

  describe('constructor', () => {
    it('supports no initial factories', async () => {
      const enabler = await deploy('PoolRecoveryEnabler', { args: [vault.address, []] });
      expect(await enabler.getFactoryCount()).to.equal(0);
    });

    it('stores initial factories', async () => {
      const factories = await Promise.all(range(5).map(randomAddress));
      const enabler = await deploy('PoolRecoveryEnabler', { args: [vault.address, factories] });
      await expectFactories(enabler, factories);
    });
  });

  describe('factory list', () => {
    describe('add', () => {
      let enabler: Contract;
      let newFactory: string;

      sharedBeforeEach(async () => {
        enabler = await deploy('PoolRecoveryEnabler', { args: [vault.address, []] });
        newFactory = await randomAddress();

        await vault.grantPermissionsGlobally([await actionId(enabler, 'addPoolFactory')], operator);
      });

      it('reverts if the caller does not have permission', async () => {
        await expect(enabler.addPoolFactory(ZERO_ADDRESS)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });

      it('new factories can be added', async () => {
        await enabler.connect(operator).addPoolFactory(newFactory);
        await expectFactories(enabler, [newFactory]);
      });

      it('duplicate factories are rejected', async () => {
        await enabler.connect(operator).addPoolFactory(newFactory);
        await expect(enabler.connect(operator).addPoolFactory(newFactory)).to.be.revertedWith('Duplicate factory');
      });
    });

    describe('remove', () => {
      let enabler: Contract;
      let factory: string;

      sharedBeforeEach(async () => {
        enabler = await deploy('PoolRecoveryEnabler', { args: [vault.address, []] });
        factory = await randomAddress();

        await vault.grantPermissionsGlobally([await actionId(enabler, 'addPoolFactory')], admin);
        await enabler.connect(admin).addPoolFactory(factory);

        await vault.grantPermissionsGlobally([await actionId(enabler, 'removePoolFactory')], operator);
      });

      it('reverts if the caller does not have permission', async () => {
        await expect(enabler.removePoolFactory(ZERO_ADDRESS)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });

      it('existing factories can be removed', async () => {
        await enabler.connect(operator).removePoolFactory(factory);
        await expectFactories(enabler, []);
      });

      it('non-existent factories are rejected', async () => {
        await enabler.connect(operator).removePoolFactory(factory);
        await expect(enabler.connect(operator).removePoolFactory(factory)).to.be.revertedWith('Non-existent factory');
      });
    });
  });

  describe('enable recovery mode', () => {
    let factories: Array<Contract>;
    let rateProvider: Contract;
    let pool: Contract;
    let enabler: Contract;

    sharedBeforeEach(async () => {
      factories = await Promise.all(
        range(3).map(() =>
          deploy('MockRecoveryRateProviderPoolFactory', { args: [vault.address, vault.protocolFeesProvider.address] })
        )
      );

      rateProvider = await deploy('MockRevertingRateProvider', { args: [] });
      const receipt = await (await factories[1].create([ZERO_ADDRESS, rateProvider.address])).wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      pool = await deployedAt('MockRecoveryRateProviderPool', event.args.pool);

      enabler = await deploy('PoolRecoveryEnabler', { args: [vault.address, factories.map((f) => f.address)] });

      await vault.grantPermissionsGlobally([await actionId(pool, 'enableRecoveryMode')], enabler);
    });

    it('reverts if the pool is not from a known factory', async () => {
      await expect(enabler.enableRecoveryModeInPool(await randomAddress())).to.be.revertedWith(
        'Pool is not from known factory'
      );
    });

    it("reverts if none of the pool's rate providers reverts", async () => {
      await expect(enabler.enableRecoveryModeInPool(pool.address)).to.be.revertedWith(
        "Pool's rate providers do not revert"
      );
    });

    it('enables recovery mode on the pool if any of the rate providers revert', async () => {
      await rateProvider.setRevertOnGetRate(true);
      await enabler.enableRecoveryModeInPool(pool.address);

      expect(await pool.inRecoveryMode()).to.equal(true);
    });
  });
});
