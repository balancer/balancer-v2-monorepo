import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/deploy';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import * as expectEvent from '../helpers/expectEvent';

describe('BasePoolFactory', function () {
  let vault: Contract;
  let factory: Contract;

  sharedBeforeEach(async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS, ZERO_ADDRESS, 0, 0] });
    factory = await deploy('MockPoolFactory', { args: [vault.address] });
  });

  it('creates a pool', async () => {
    const receipt = await (await factory.create()).wait();
    expectEvent.inReceipt(receipt, 'PoolRegistered');
  });
});
