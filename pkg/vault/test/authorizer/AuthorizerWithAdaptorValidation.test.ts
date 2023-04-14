import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { impersonateAccount, setBalance } from '@nomicfoundation/hardhat-network-helpers';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('AuthorizerWithAdaptorValidation', () => {
  let vault: Contract, authorizerAdaptor: Contract, adaptorEntrypoint: Contract;
  let user: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract;
  let actualAuthorizer: Contract;
  let admin: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy old authorizer and helper', async () => {
    actualAuthorizer = await deploy('MockBasicAuthorizer', { from: admin });

    vault = await deploy('Vault', { args: [actualAuthorizer.address, ZERO_ADDRESS, 0, 0] });

    authorizerAdaptor = await deploy('v2-liquidity-mining/AuthorizerAdaptor', {
      args: [vault.address],
    });

    adaptorEntrypoint = await deploy('v2-liquidity-mining/AuthorizerAdaptorEntrypoint', {
      args: [authorizerAdaptor.address],
    });

    authorizer = await deploy('AuthorizerWithAdaptorValidation', {
      args: [actualAuthorizer.address, authorizerAdaptor.address, adaptorEntrypoint.address],
    });
  });

  it('stores the actual (existing basic) authorizer', async () => {
    expect(await authorizer.getActualAuthorizer()).to.equal(actualAuthorizer.address);
  });

  it('stores the authorizer adaptor', async () => {
    expect(await authorizer.getAuthorizerAdaptor()).to.equal(authorizerAdaptor.address);
  });

  it('stores the authorizer adaptor entrypoint', async () => {
    expect(await authorizer.getAuthorizerAdaptorEntrypoint()).to.equal(adaptorEntrypoint.address);
  });

  describe('canPerform', () => {
    const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
    const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

    let adaptorSigner: SignerWithAddress;

    sharedBeforeEach('grant permission on the old authorizer', async () => {
      await actualAuthorizer.connect(admin).grantRole(ROLE_1, user.address);
    });

    sharedBeforeEach('impersonate adaptor', async () => {
      await impersonateAccount(authorizerAdaptor.address);
      await setBalance(authorizerAdaptor.address, fp(1));

      // Simulate a call from the real AuthorizerAdaptor by "casting" it as a Signer,
      // so it can be used with `connect` like an EOA
      adaptorSigner = await SignerWithAddress.create(ethers.provider.getSigner(authorizerAdaptor.address));
    });

    context('when sender is the authorizer adaptor', () => {
      it('allows when account is the entrypoint', async () => {
        expect(await authorizer.connect(adaptorSigner).canPerform(ROLE_1, adaptorEntrypoint.address, ANY_ADDRESS)).to.be
          .true;
      });

      it('denies when account is not the entrypoint', async () => {
        expect(await authorizer.connect(adaptorSigner).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.false;
      });
    });

    context('when sender is not the adaptor', () => {
      it('properly delegates to the old authorizer', async () => {
        expect(await authorizer.connect(user).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.true;
        expect(await authorizer.connect(user).canPerform(ROLE_2, user.address, ANY_ADDRESS)).to.be.false;
        expect(await authorizer.connect(other).canPerform(ROLE_1, other.address, ANY_ADDRESS)).to.be.false;
      });
    });

    describe('Adaptor and Entrypoint interactions (post-upgrade)', () => {
      sharedBeforeEach('upgrade to the new authorizer', async () => {
        await actualAuthorizer.connect(admin).grantRole(await actionId(vault, 'setAuthorizer'), admin.address);
        await vault.connect(admin).setAuthorizer(authorizer.address);
      });

      it('adaptor calls from entrypoint contract succeed', async () => {
        expect(await authorizer.connect(adaptorSigner).canPerform(ROLE_1, adaptorEntrypoint.address, ANY_ADDRESS)).to.be
          .true;
      });

      it('unauthorized calls through the entrypoint contract fail', async () => {
        expect(await authorizer.connect(user).canPerform(ROLE_1, adaptorEntrypoint.address, ANY_ADDRESS)).to.be.false;
      });

      it('adaptor calls from non-entrypoint contract fail', async () => {
        expect(await authorizer.connect(adaptorSigner).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.false;
      });

      it('regular permissions still work after the upgrade', async () => {
        expect(await authorizer.connect(user).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.true;
        expect(await authorizer.connect(user).canPerform(ROLE_2, user.address, ANY_ADDRESS)).to.be.false;
      });

      it('permissions revoked on the actual authorizer are reflected in the new', async () => {
        actualAuthorizer.connect(admin).revokeRole(ROLE_1, user.address);

        expect(await actualAuthorizer.connect(user).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.false;
        expect(await authorizer.connect(user).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.false;
      });
    });
  });
});
