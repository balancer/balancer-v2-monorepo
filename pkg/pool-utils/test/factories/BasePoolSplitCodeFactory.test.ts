import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS, ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { expect } from 'chai';

describe('BasePoolSplitCodeFactory', function () {
  let vault: Contract;
  let factory: Contract;
  let authorizer: Contract;
  let admin: SignerWithAddress;
  let other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });

    factory = await deploy('MockPoolSplitCodeFactory', { args: [vault.address] });

    const action = await actionId(factory, 'disable');
    await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
  });

  it('stores the vault address', async () => {
    expect(await factory.getVault()).to.equal(vault.address);
  });

  it('emits an event', async () => {
    const receipt = await (await factory.create()).wait();
    expectEvent.inReceipt(receipt, 'PoolCreated');
  });

  context('with a created pool', () => {
    let pool: string;

    sharedBeforeEach('create pool', async () => {
      const receipt = await (await factory.create()).wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      pool = event.args.pool;
    });

    it('tracks pools created by the factory', async () => {
      expect(await factory.isPoolFromFactory(pool)).to.be.true;
    });

    it('does not track pools that were not created by the factory', async () => {
      expect(await factory.isPoolFromFactory(other.address)).to.be.false;
    });
  });

  describe('disable', () => {
    context('when enabled', () => {
      it('disabled should be false', async () => {
        expect(await factory.isDisabled()).to.be.false;
      });

      it('allows creation', async () => {
        await expect(factory.create()).to.not.be.reverted;
      });

      it('prevents non-admins from disabling', async () => {
        await expect(factory.connect(other).disable()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when disabled', () => {
      sharedBeforeEach('disable the factory', async () => {
        const receipt = await factory.connect(admin).disable();

        expectEvent.inReceipt(await receipt.wait(), 'FactoryDisabled');
      });

      it('disabled should be true', async () => {
        expect(await factory.isDisabled()).to.be.true;
      });

      it('should not allow creation', async () => {
        await expect(factory.create()).to.be.revertedWith('DISABLED');
      });

      it('should not allow disabling twice', async () => {
        await expect(factory.connect(admin).disable()).to.be.revertedWith('DISABLED');
      });
    });
  });
});
