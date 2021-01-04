import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../scripts/helpers/deploy';
import { ZERO_ADDRESS } from '../helpers/constants';

describe('BasePoolFactory', function () {
  let authorizer: Contract;
  let vault: Contract;
  let factory: Contract;

  const salt = ethers.utils.id('salt');

  beforeEach(async function () {
    authorizer = await deploy('MockAuthorizer', { args: [ZERO_ADDRESS] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    factory = await deploy('MockPoolFactory', { args: [vault.address] });

    await authorizer.setAuthorized(factory.address);
  });

  it('reverts if the factory is not authorized', async () => {
    await expect(factory.create(salt)).to.be.revertedWith('Caller cannot add Universal Agents');
  });

  context('once authorized', () => {
    beforeEach(async () => {
      await authorizer.setCanAddUniversalAgent(true);
    });

    it('creates a pool', async () => {
      const receipt = await (await factory.create(salt)).wait();
      expectEvent.inReceipt(receipt, 'PoolCreated');
    });

    it('salt cannot be reused', async () => {
      await factory.create(salt);
      await expect(factory.create(salt)).to.be.reverted;
    });

    context('with pool', () => {
      let pool: Contract;

      beforeEach(async () => {
        const receipt = await (await factory.create(salt)).wait();
        const event = expectEvent.inReceipt(receipt, 'PoolCreated');

        pool = await ethers.getContractAt('MockFactoryCreatedPool', event.args.pool);
      });

      it('pool is a universal agent', async () => {
        // The contract also asserts that it is a universal agent at the time of its construction

        expect(await vault.getNumberOfUniversalAgents()).to.equal(1);
        expect(await vault.getUniversalAgents(0, 1)).to.have.members([pool.address]);
      });
    });
  });
});
