import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('SingletonAuthentication', () => {
  let singleton: Contract;
  let authorizer: Contract;
  let vault: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault and singleton', async () => {
    ({ instance: vault, authorizer } = await Vault.create({ admin }));

    const action = await actionId(vault, 'setAuthorizer');
    await authorizer.connect(admin).grantPermission(action, admin.address, ANY_ADDRESS);

    singleton = await deploy('SingletonAuthenticationMock', { args: [vault.address] });
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await singleton.getVault()).to.be.eq(vault.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await singleton.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      await vault.connect(admin).setAuthorizer(other.address);

      expect(await singleton.getAuthorizer()).to.equal(other.address);
    });
  });

  describe('disambiguation', () => {
    const selector = '0x12345678';
    let secondOne: Contract;

    sharedBeforeEach('deploy second singleton', async () => {
      secondOne = await deploy('SingletonAuthenticationMock', { args: [vault.address] });
    });

    it('disambiguates selectors', async () => {
      const firstActionId = await singleton.getActionId(selector);
      const secondActionId = await secondOne.getActionId(selector);

      expect(firstActionId).to.not.equal(secondActionId);
    });
  });
});
