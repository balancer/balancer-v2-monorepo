import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

describe('BasePoolFactory', function () {
  let admin: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let factory: Contract;

  before(async () => {
    [, admin] = await ethers.getSigners();
  });

  beforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    factory = await deploy('MockPoolFactory', { args: [vault.address] });
  });

  it('creates a pool', async () => {
    const receipt = await (await factory.create()).wait();
    expectEvent.inReceipt(receipt, 'PoolCreated');
  });

  context('with pool', () => {
    let pool: Contract;

    beforeEach(async () => {
      const receipt = await (await factory.create()).wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      pool = await ethers.getContractAt('MockFactoryCreatedPool', event.args.pool);
    });

    it('reports created pools', async () => {
      expect(await factory.getNumberOfCreatedPools()).to.equal(1);
      expect(await factory.getCreatedPoolIds(0, 1)).to.deep.equal([await pool.getPoolId()]);
    });

    it('creates multiple pools pools', async () => {
      await factory.create();

      expect(await factory.getNumberOfCreatedPools()).to.equal(2);
    });
  });
});
