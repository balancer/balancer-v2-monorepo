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
import { defaultAbiCoder } from 'ethers/lib/utils';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('AuthorizerWithAdaptorValidation', () => {
  let vault: Contract, authorizerAdaptor: Contract, adaptorEntrypoint: Contract;
  let user: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract;
  let actualAuthorizer: Contract;
  let admin: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy actual authorizer and helper', async () => {
    actualAuthorizer = await deploy('v2-solidity-utils/MockBasicAuthorizer', { from: admin });

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

    sharedBeforeEach('grant permission on the actual authorizer', async () => {
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
      it('properly delegates to the actual authorizer', async () => {
        expect(await authorizer.connect(user).canPerform(ROLE_1, user.address, ANY_ADDRESS)).to.be.true;
        expect(await authorizer.connect(user).canPerform(ROLE_2, user.address, ANY_ADDRESS)).to.be.false;
        expect(await authorizer.connect(other).canPerform(ROLE_1, other.address, ANY_ADDRESS)).to.be.false;
      });
    });
  });

  describe('Adaptor and Entrypoint interactions (post-upgrade)', () => {
    let action;
    let target: string;
    let calldata: string;
    let expectedResult: string;

    sharedBeforeEach('upgrade to the new authorizer', async () => {
      await actualAuthorizer.connect(admin).grantRole(await actionId(vault, 'setAuthorizer'), admin.address);
      await vault.connect(admin).setAuthorizer(authorizer.address);
    });

    sharedBeforeEach('prepare call and grant adaptor permission', async () => {
      // We're going to have the Adaptor call a view function in the Vault. The fact that this is not a permissioned
      // function is irrelevant - we just want to make the Adaptor call it. We'll grant the user permission to make this
      // call.
      action = await actionId(authorizerAdaptor, 'getProtocolFeesCollector', vault.interface);
      await actualAuthorizer.connect(admin).grantRole(action, user.address);

      target = vault.address;

      // The extra bytes are not required to perform the call, but for testing purposes it's slightly more complete if
      // the selector does not match the entire calldata.
      calldata = vault.interface.encodeFunctionData('getProtocolFeesCollector').concat('aabbccddeeff');

      expectedResult = defaultAbiCoder.encode(['address'], [await vault.getProtocolFeesCollector()]);
    });

    it('unauthorized calls to the adaptor fail', async () => {
      await expect(authorizerAdaptor.connect(other).performAction(target, calldata)).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });

    it('authorized calls to the adaptor fail', async () => {
      await expect(authorizerAdaptor.connect(user).performAction(target, calldata)).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });

    it('unauthorized calls through the entrypoint fail', async () => {
      await expect(adaptorEntrypoint.connect(other).performAction(target, calldata)).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });

    it('authorized calls through the entrypoint succeed', async () => {
      const tx = await adaptorEntrypoint.connect(user).performAction(target, calldata);

      expectEvent.inReceipt(await tx.wait(), 'ActionPerformed', { caller: user.address, data: calldata, target });

      const result = await adaptorEntrypoint.connect(user).callStatic.performAction(target, calldata);
      expect(result).to.equal(expectedResult);
    });

    it('other permissions are unaffected', async () => {
      // The admin had permission to call `setAuthorizer` on the Vault before the upgrade, and still does.
      await vault.connect(admin).setAuthorizer(ZERO_ADDRESS);
      expect(await vault.getAuthorizer()).to.equal(ZERO_ADDRESS);
    });
  });
});
