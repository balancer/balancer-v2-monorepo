import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('SingletonAuthentication', () => {
  let singleton: Contract;
  let authorizer: Contract;
  let authorizedVault: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault and singleton', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    authorizedVault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });

    const action = await actionId(authorizedVault, 'setAuthorizer');
    await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);

    singleton = await deploy('SingletonAuthenticationMock', { args: [authorizedVault.address] });
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await singleton.getVault()).to.be.eq(authorizedVault.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await singleton.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      await authorizedVault.connect(admin).setAuthorizer(other.address);

      expect(await singleton.getAuthorizer()).to.equal(other.address);
    });
  });

  describe('disambiguation', () => {
    const selector = '0x12345678';
    let secondOne: Contract;

    sharedBeforeEach('deploy second singleton', async () => {
      secondOne = await deploy('SingletonAuthenticationMock', { args: [authorizedVault.address] });
    });

    it('disambiguates selectors', async () => {
      const firstActionId = await singleton.getActionId(selector);
      const secondActionId = await secondOne.getActionId(selector);

      expect(firstActionId).to.not.equal(secondActionId);
    });
  });
});
