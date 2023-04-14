import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { impersonate, getForkedNetwork, Task, TaskMode, describeForkTest } from '../../../src';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describeForkTest('AuthorizerWithAdaptorValidation', 'mainnet', 17047707, function () {
  let user: SignerWithAddress, other: SignerWithAddress, admin: SignerWithAddress;
  let govMultisig: SignerWithAddress, lmMultisig: SignerWithAddress;
  let authorizer: Contract,
    vault: Contract,
    actualAuthorizer: Contract,
    authorizerAdaptor: Contract,
    adaptorEntrypoint: Contract,
    gaugeAdder,
    gaugeFactory: Contract;
  let allowedAction: string, setAuthorizerAction: string, addFactoryAction: string;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const LM_MULTISIG = '0xc38c5f97b34e175ffd35407fc91a937300e33860';

  before('run task', async () => {
    task = new Task('20230414-authorizer-wrapper', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    authorizer = await task.deployedInstance('AuthorizerWithAdaptorValidation');
  });

  before('load signers', async () => {
    [, admin, user, other] = await ethers.getSigners();

    govMultisig = await impersonate(GOV_MULTISIG);
    lmMultisig = await impersonate(LM_MULTISIG, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');
    actualAuthorizer = await new Task(
      '20210418-authorizer',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('Authorizer');

    authorizerAdaptor = await new Task(
      '20220325-authorizer-adaptor',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('AuthorizerAdaptor');

    adaptorEntrypoint = await new Task(
      '20221124-authorizer-adaptor-entrypoint',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('AuthorizerAdaptorEntrypoint');

    gaugeAdder = await new Task('20230109-gauge-adder-v3', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance(
      'GaugeAdder'
    );

    // Need to create a new factory (or it will say factory already added)
    const factoryTask = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.TEST, getForkedNetwork(hre));
    await factoryTask.run({ force: true });
    gaugeFactory = await factoryTask.deployedInstance('LiquidityGaugeFactory');

    expect(await gaugeFactory.isGaugeFromFactory(ZERO_ADDRESS)).to.be.false;
  });

  before('get actions', async () => {
    allowedAction = await actionId(authorizerAdaptor, 'getProtocolFeesCollector', vault.interface);
    setAuthorizerAction = await actionId(vault, 'setAuthorizer');
    addFactoryAction = await actionId(gaugeAdder, 'addGaugeFactory');

    await actualAuthorizer.connect(govMultisig).grantRole(allowedAction, user.address);
    await actualAuthorizer.connect(govMultisig).grantRole(addFactoryAction, lmMultisig.address);
  });

  describe('getters', () => {
    it('stores the actual (existing basic) authorizer', async () => {
      expect(await authorizer.getActualAuthorizer()).to.eq(actualAuthorizer.address);
    });

    it('stores the authorizer adaptor', async () => {
      expect(await authorizer.getAuthorizerAdaptor()).to.eq(authorizerAdaptor.address);
    });

    it('stores the authorizer adaptor entrypoint', async () => {
      expect(await authorizer.getAuthorizerAdaptorEntrypoint()).to.equal(adaptorEntrypoint.address);
    });

    it('configures the gauge adder', async () => {
      const entrypoint = await gaugeAdder.getAuthorizerAdaptorEntrypoint();
      const gaugeAdderAuthorizer = await adaptorEntrypoint.getAuthorizer();

      // Ensure the authorizer we just set the permissions on is the same one the gauge adder is using
      expect(entrypoint).to.equal(adaptorEntrypoint.address);
      expect(gaugeAdderAuthorizer).to.equal(actualAuthorizer.address);
    });
  });

  describe('canPerform', () => {
    let adaptorSigner: SignerWithAddress;

    before('impersonate adaptor', async () => {
      await impersonate(authorizerAdaptor.address, fp(10));

      // Simulate a call from the real AuthorizerAdaptor by "casting" it as a Signer,
      // so it can be used with `connect` like an EOA
      adaptorSigner = await SignerWithAddress.create(ethers.provider.getSigner(authorizerAdaptor.address));
    });

    context('when sender is the authorizer adaptor', () => {
      it('allows when account is the entrypoint', async () => {
        expect(
          await authorizer.connect(adaptorSigner).canPerform(allowedAction, adaptorEntrypoint.address, vault.address)
        ).to.be.true;
      });

      it('denies when account is not the entrypoint', async () => {
        expect(await authorizer.connect(adaptorSigner).canPerform(allowedAction, user.address, vault.address)).to.be
          .false;
      });
    });

    context('when sender is not the adaptor', () => {
      it('properly delegates to the actual authorizer', async () => {
        expect(await authorizer.connect(user).canPerform(allowedAction, user.address, vault.address)).to.be.true;
        expect(await authorizer.connect(user).canPerform(setAuthorizerAction, user.address, vault.address)).to.be.false;
        expect(await authorizer.connect(other).canPerform(allowedAction, other.address, vault.address)).to.be.false;
      });
    });
  });

  describe('Adaptor and Entrypoint interactions (post-upgrade)', () => {
    let action;
    let target: string;
    let calldata: string;
    let expectedResult: string;

    before('upgrade to the new authorizer', async () => {
      await actualAuthorizer.connect(govMultisig).grantRole(setAuthorizerAction, admin.address);

      await vault.connect(admin).setAuthorizer(authorizer.address);
      expect(await vault.getAuthorizer()).to.equal(authorizer.address);
    });

    before('prepare call and grant adaptor permission', async () => {
      // We're going to have the Adaptor call a view function in the Vault. The fact that this is not a permissioned
      // function is irrelevant - we just want to make the Adaptor call it. We'll grant the user permission to make this
      // call.
      action = await actionId(authorizerAdaptor, 'getProtocolFeesCollector', vault.interface);
      await actualAuthorizer.connect(govMultisig).grantRole(action, user.address);

      target = vault.address;

      // The extra bytes are not required to perform the call, but for testing purposes it's slightly more complete if
      // the selector does not match the entire calldata.
      calldata = vault.interface.encodeFunctionData('getProtocolFeesCollector').concat('aabbccddeeff');

      expectedResult = defaultAbiCoder.encode(['address'], [await vault.getProtocolFeesCollector()]);
    });

    it('unauthorized calls to the adaptor fail', async () => {
      await expect(authorizerAdaptor.connect(other).performAction(target, calldata)).to.be.revertedWith('BAL#401');
    });

    it('authorized calls to the adaptor fail', async () => {
      await expect(authorizerAdaptor.connect(user).performAction(target, calldata)).to.be.revertedWith('BAL#401');
    });

    it('unauthorized calls through the entrypoint fail', async () => {
      await expect(adaptorEntrypoint.connect(other).performAction(target, calldata)).to.be.revertedWith('BAL#401');
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

  it('can use gauge adder V3', async () => {
    const tx = await gaugeAdder.connect(lmMultisig).addGaugeFactory(gaugeFactory.address, 2); // Ethereum is type 2
    expectEvent.inReceipt(await tx.wait(), 'GaugeFactoryAdded', {
      gaugeType: 2,
      gaugeFactory: gaugeFactory.address,
    });
  });
});
