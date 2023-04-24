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
import { randomBytes } from 'ethers/lib/utils';

describe('PoolRecoveryHelper', function () {
  let vault: Vault;

  let admin: SignerWithAddress, operator: SignerWithAddress;

  before(async () => {
    [, admin, operator] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    vault = await Vault.create({ admin });
  });

  async function expectFactories(helper: Contract, expectedFactories: Array<string>): Promise<void> {
    expect(await helper.getFactoryCount()).to.equal(expectedFactories.length);
    for (let i = 0; i < expectedFactories.length; ++i) {
      expect(await helper.getFactoryAtIndex(i)).to.equal(expectedFactories[i]);
    }
  }

  describe('constructor', () => {
    it('supports no initial factories', async () => {
      const helper = await deploy('PoolRecoveryHelper', { args: [vault.address, []] });
      expect(await helper.getFactoryCount()).to.equal(0);
    });

    it('stores initial factories', async () => {
      const factories = range(5).map(randomAddress);
      const helper = await deploy('PoolRecoveryHelper', { args: [vault.address, factories] });
      await expectFactories(helper, factories);
    });
  });

  describe('factory list', () => {
    describe('add', () => {
      let helper: Contract;
      let newFactory: string;

      sharedBeforeEach(async () => {
        helper = await deploy('PoolRecoveryHelper', { args: [vault.address, []] });
        newFactory = randomAddress();

        await vault.grantPermissionGlobally(await actionId(helper, 'addPoolFactory'), operator);
      });

      it('reverts if the caller does not have permission', async () => {
        await expect(helper.addPoolFactory(ZERO_ADDRESS)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });

      it('new factories can be added', async () => {
        await helper.connect(operator).addPoolFactory(newFactory);
        await expectFactories(helper, [newFactory]);
      });

      it('duplicate factories are rejected', async () => {
        await helper.connect(operator).addPoolFactory(newFactory);
        await expect(helper.connect(operator).addPoolFactory(newFactory)).to.be.revertedWith('Duplicate factory');
      });
    });

    describe('remove', () => {
      let helper: Contract;
      let factory: string;

      sharedBeforeEach(async () => {
        helper = await deploy('PoolRecoveryHelper', { args: [vault.address, []] });
        factory = randomAddress();

        await vault.grantPermissionGlobally(await actionId(helper, 'addPoolFactory'), admin);
        await helper.connect(admin).addPoolFactory(factory);

        await vault.grantPermissionGlobally(await actionId(helper, 'removePoolFactory'), operator);
      });

      it('reverts if the caller does not have permission', async () => {
        await expect(helper.removePoolFactory(ZERO_ADDRESS)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });

      it('existing factories can be removed', async () => {
        await helper.connect(operator).removePoolFactory(factory);
        await expectFactories(helper, []);
      });

      it('non-existent factories are rejected', async () => {
        await helper.connect(operator).removePoolFactory(factory);
        await expect(helper.connect(operator).removePoolFactory(factory)).to.be.revertedWith('Non-existent factory');
      });
    });
  });

  describe('enable recovery mode', () => {
    let factories: Array<Contract>;
    let rateProvider: Contract;
    let pool: Contract;
    let helper: Contract;

    sharedBeforeEach(async () => {
      factories = await Promise.all(
        range(3).map(() =>
          deploy('MockRecoveryRateProviderPoolFactory', { args: [vault.address, vault.protocolFeesProvider.address] })
        )
      );

      rateProvider = await deploy('MockRevertingRateProvider');
      const receipt = await (await factories[1].create([ZERO_ADDRESS, rateProvider.address], randomBytes(32))).wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      pool = await deployedAt('MockRecoveryRateProviderPool', event.args.pool);

      helper = await deploy('PoolRecoveryHelper', { args: [vault.address, factories.map((f) => f.address)] });

      await vault.grantPermissionGlobally(await actionId(pool, 'enableRecoveryMode'), helper);
    });

    it('reverts if the pool is not from a known factory', async () => {
      await expect(helper.enableRecoveryMode(randomAddress())).to.be.revertedWith('Pool is not from known factory');
    });

    it("reverts if none of the pool's rate providers reverts", async () => {
      await expect(helper.enableRecoveryMode(pool.address)).to.be.revertedWith("Pool's rate providers do not revert");
    });

    it('enables recovery mode on the pool if any of the rate providers revert', async () => {
      await rateProvider.setRevertOnGetRate(true);
      await helper.enableRecoveryMode(pool.address);

      expect(await pool.inRecoveryMode()).to.equal(true);
    });
  });
});
