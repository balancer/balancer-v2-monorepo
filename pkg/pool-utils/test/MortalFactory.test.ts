import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

describe('MortalFactory', () => {
  let admin: SignerWithAddress;
  let other: SignerWithAddress;
  let vault: Contract;
  let authorizer: Contract;
  let factory: Contract;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and factory', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });

    factory = await deploy('MockMortalFactory', { args: [vault.address] });

    const action = await actionId(factory, 'disable');
    await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
  });

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
  });
});
