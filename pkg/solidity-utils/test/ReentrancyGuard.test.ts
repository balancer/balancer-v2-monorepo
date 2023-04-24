import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ReentrancyGuard', () => {
  let reentrancyMock: Contract;

  sharedBeforeEach(async function () {
    reentrancyMock = await deploy('ReentrancyMock');
    expect(await reentrancyMock.counter()).to.equal('0');
  });

  it('does not allow remote callback', async function () {
    const attacker = await deploy('ReentrancyAttack');
    await expect(reentrancyMock.countAndCall(attacker.address)).to.be.revertedWith('REENTRANCY_ATTACK');
  });

  // The following are more side-effects than intended behavior:
  // I put them here as documentation, and to monitor any changes
  // in the side-effects.
  it('does not allow local recursion', async function () {
    await expect(reentrancyMock.countLocalRecursive(10)).to.be.revertedWith('REENTRANCY');
  });

  it('does not allow indirect local recursion', async function () {
    await expect(reentrancyMock.countThisRecursive(10)).to.be.revertedWith('REENTRANCY_MOCK');
  });
});
