import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { SignerWithAddress } from 'hardhat-deploy-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';

describe('BasePoolFactory', function () {
  let admin: SignerWithAddress;

  let vault: Contract;
  let factory: Contract;

  const salt = ethers.utils.id('salt');

  before(async function () {
    [, admin] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });
    factory = await deploy('MockPoolFactory', { args: [vault.address] });
  });

  it('fails if not trusted by the vault', async () => {
    await expect(factory.create(salt)).to.be.revertedWith('Caller is not trusted operator reporter');
  });

  context('once trusted by the vault', () => {
    beforeEach(async () => {
      await vault.connect(admin).authorizeTrustedOperatorReporter(factory.address);
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

      it('pool is a trusted operator', async () => {
        // The contract also asserts that it is a trusted operator at the time of its construction

        expect(await vault.getTotalTrustedOperators()).to.equal(1);
        expect(await vault.getTrustedOperators(0, 1)).to.have.members([pool.address]);
      });
    });
  });
});
