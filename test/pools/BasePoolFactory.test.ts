import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../lib/helpers/deploy';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';

describe('BasePoolFactory', function () {
  let vault: Contract;
  let factory: Contract;
  let admin: SignerWithAddress;

  before(async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS, 0, 0] });
    factory = await deploy('MockPoolFactory', { args: [vault.address] });
  });

  it('creates a pool', async () => {
    const receipt = await (await factory.create()).wait();
    expectEvent.inReceipt(receipt, 'PoolRegistered');
  });
});
