import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../lib/helpers/deploy';

describe('BasePoolFactory', function () {
  let admin: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let factory: Contract;

  before(async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    factory = await deploy('MockPoolFactory', { args: [vault.address] });
  });

  it('creates a pool', async () => {
    const receipt = await (await factory.create()).wait();
    expectEvent.inReceipt(receipt, 'PoolCreated');
  });
});
