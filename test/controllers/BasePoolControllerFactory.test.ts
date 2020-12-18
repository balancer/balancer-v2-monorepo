import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';

describe('BasePoolControllerFactory', function () {
  let admin: SignerWithAddress;

  let vault: Contract;
  let factory: Contract;

  const salt = ethers.utils.id('salt');

  before(async function () {
    [, admin] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });
    factory = await deploy('MockPoolControllerFactory', { args: [vault.address] });
  });

  it('fails if not trusted by the vault', async () => {
    await expect(factory.create(salt)).to.be.revertedWith('Caller is not a universal agent manager');
  });

  context('once trusted by the vault', () => {
    beforeEach(async () => {
      await vault.connect(admin).addUniversalAgentManager(factory.address);
    });

    it('creates a pool controller', async () => {
      const receipt = await (await factory.create(salt)).wait();
      expectEvent.inReceipt(receipt, 'ControllerCreated');
    });

    it('salt cannot be reused', async () => {
      await factory.create(salt);
      await expect(factory.create(salt)).to.be.reverted;
    });

    context('with controller', () => {
      let controller: Contract;

      beforeEach(async () => {
        const receipt = await (await factory.create(salt)).wait();
        const event = expectEvent.inReceipt(receipt, 'ControllerCreated');

        controller = await ethers.getContractAt('MockPoolController', event.args.controller);
      });

      it('controller is a universal agent', async () => {
        // The contract also asserts that it is a universal agent at the time of its construction

        expect(await vault.getNumberOfUniversalAgents()).to.equal(1);
        expect(await vault.getUniversalAgents(0, 1)).to.have.members([controller.address]);
      });
    });
  });
});
