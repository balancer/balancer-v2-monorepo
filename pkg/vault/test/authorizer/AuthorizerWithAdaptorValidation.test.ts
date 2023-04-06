import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('AuthorizerWithAdaptorValidation', () => {
  let authorizerAdaptor: SignerWithAddress, adaptorEntrypoint: SignerWithAddress;
  let user: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract;
  let oldAuthorizer: Contract;
  let admin: SignerWithAddress;

  before('setup signers', async () => {
    [admin, user, other, authorizerAdaptor, adaptorEntrypoint] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy old authorizer and helper', async () => {
    oldAuthorizer = await deploy('MockBasicAuthorizer');

    authorizer = await deploy('AuthorizerWithAdaptorValidation', {
      args: [oldAuthorizer.address, authorizerAdaptor.address, adaptorEntrypoint.address],
    });
  });

  it('stores the old authorizer', async () => {
    expect(await authorizer.getOldAuthorizer()).to.equal(oldAuthorizer.address);
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

    sharedBeforeEach('grant permission on the old authorizer', async () => {
      await oldAuthorizer.connect(admin).grantRole(ROLE_1, user.address);
    });

    context('when sender is the authorizer adaptor', () => {
      it('allows when account is the entrypoint', async () => {
        expect(await authorizer.connect(authorizerAdaptor).canPerform(ROLE_1, adaptorEntrypoint.address, ANY_ADDRESS))
          .to.be.true;
      });

      it('denies when account is not the entrypoint', async () => {
        expect(await authorizer.connect(authorizerAdaptor).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.false;
      });
    });

    context('when sender is not the adaptor', () => {
      it('properly delegates to the old authorizer', async () => {
        expect(await authorizer.connect(user).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.true;
        expect(await authorizer.connect(user).canPerform(ROLE_2, user.address, ANY_ADDRESS)).to.be.false;
        expect(await authorizer.connect(other).canPerform(ROLE_1, other.address, ANY_ADDRESS)).to.be.false;
      });
    });
  });
});
