import hre, { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('DelayedCall', () => {
  let mockAuthorizer: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress;

  const ANYWHERE = ZERO_ADDRESS;

  before('setup signers', async () => {
    [, admin, grantee, other] = await ethers.getSigners();
  });

  const ACTION_ID_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  let targetMethodData: string;
  sharedBeforeEach('deploy mock Authorizer', async () => {
    mockAuthorizer = await deploy('MockDelayedCallCreator', { args: [] });
    targetMethodData = mockAuthorizer.interface.encodeFunctionData('targetAction', [123]);
  });

  describe('DelayedCall Creation', () => {
    let delayedCallParams: any[];
    beforeEach('init DelayedCall params', async () => {
      const value = 0;
      const isTriggerPermissioned = false;
      delayedCallParams = [
        targetMethodData,
        mockAuthorizer.address,
        value,
        mockAuthorizer.address,
        mockAuthorizer.address,
        isTriggerPermissioned,
        ACTION_ID_1,
      ];
    });
    context('Constructor', () => {
      it('creates a DelayedCall successfully', async () => {
        const delayedCall = await deploy('DelayedCall', {
          args: delayedCallParams,
        });
        const now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;

        expect(await delayedCall.start()).to.equal(`${now}`);
        expect(await delayedCall.where()).to.equal(mockAuthorizer.address);
        expect(await delayedCall.data()).to.equal(targetMethodData);
        expect(await delayedCall.actionId()).to.equal(ACTION_ID_1);
        expect(await delayedCall.value()).to.equal(0);
        expect(await delayedCall.isTriggerPermissioned()).to.equal(false);
        expect(await delayedCall.cancelled()).to.equal(false);
      });
    });
  });

  describe('DelayedCall executtion', () => {
    context('permissionless trigger', () => {
      let delayedCall: Contract;
      beforeEach(async () => {
        delayedCall = await deploy('DelayedCall', {
          args: [
            targetMethodData,
            mockAuthorizer.address,
            0,
            mockAuthorizer.address,
            mockAuthorizer.address,
            false,
            ACTION_ID_1,
          ],
        });
        // wont check because is not permissined
        await mockAuthorizer.setCanPerform(false);
      });
      it('triggers succesfully', async () => {
        await mockAuthorizer.setDelay(3600);
        await ethers.provider.send('evm_increaseTime', [3600]);
        await ethers.provider.send('evm_mine', []);
        const tx = await delayedCall.trigger();
        const receipt = await tx.wait();
        console.log(receipt.events)
        expect(await delayedCall.triggered()).to.equal(true);
        expect(await mockAuthorizer.triggeredValue()).to.equal(123);
        expectEvent.inReceipt(receipt, 'DelayedCallExecuted', {
          actionId: ACTION_ID_1,
          where: mockAuthorizer.address,
          value: 0,
          data: targetMethodData,
        });

      });

      it('fails if early', async () => {
        await mockAuthorizer.setDelay(3600);
        await ethers.provider.send('evm_increaseTime', [100]);
        await ethers.provider.send('evm_mine', []);
        await expect(delayedCall.trigger()).to.be.revertedWith('Action triggered too soon');
      });

      it('fails if already triggered', async () => {
        await mockAuthorizer.setDelay(3600);
        await ethers.provider.send('evm_increaseTime', [3600]);
        await ethers.provider.send('evm_mine', []);
        await delayedCall.trigger();
        await expect(delayedCall.trigger()).to.be.revertedWith('Action already triggered');
      });
    });

    context('permissioned trigger', () => {
      let delayedCall: Contract;
      beforeEach(async () => {
        delayedCall = await deploy('DelayedCall', {
          args: [
            targetMethodData,
            mockAuthorizer.address,
            0,
            mockAuthorizer.address,
            mockAuthorizer.address,
            true,
            ACTION_ID_1,
          ],
        });
      });

      it('fails if not authorized', async () => {
        await mockAuthorizer.setCanPerform(false);
        await mockAuthorizer.setDelay(3600);
        await ethers.provider.send('evm_increaseTime', [3600]);
        await ethers.provider.send('evm_mine', []);
        await expect(delayedCall.trigger()).to.be.revertedWith('Not Authorized');
      });
    });

    context('cancellation', () => {
      let delayedCall: Contract;
      beforeEach(async () => {
        delayedCall = await deploy('DelayedCall', {
          args: [
            targetMethodData,
            mockAuthorizer.address,
            0,
            mockAuthorizer.address,
            mockAuthorizer.address,
            true,
            ACTION_ID_1,
          ],
        });
        await mockAuthorizer.setCanPerform(true);
      });
      it('can cancel', async () => {
        await delayedCall.cancel();
        expect(await delayedCall.cancelled()).to.equal(true);
      });

      it('triggering fails if cancelled', async () => {
        await delayedCall.cancel();
        await mockAuthorizer.setDelay(3600);
        await ethers.provider.send('evm_increaseTime', [3600]);
        await ethers.provider.send('evm_mine', []);
        await expect(delayedCall.trigger()).to.be.revertedWith('Action is cancelled');
      });

      it('cant cancel if triggered', async () => {
        const delayedCall = await deploy('DelayedCall', {
          args: [
            targetMethodData,
            mockAuthorizer.address,
            0,
            mockAuthorizer.address,
            mockAuthorizer.address,
            true,
            ACTION_ID_1,
          ],
        });
        await mockAuthorizer.setDelay(3600);
        await ethers.provider.send('evm_increaseTime', [3600]);
        await ethers.provider.send('evm_mine', []);
        await delayedCall.trigger();
        await expect(delayedCall.cancel()).to.be.revertedWith('Cannot cancel triggered action');
      });

      it('cant cancel if already cancelled', async () => {
        const delayedCall = await deploy('DelayedCall', {
          args: [
            targetMethodData,
            mockAuthorizer.address,
            0,
            mockAuthorizer.address,
            mockAuthorizer.address,
            true,
            ACTION_ID_1,
          ],
        });
        await delayedCall.cancel();
        await expect(delayedCall.cancel()).to.be.revertedWith('Action already cancelled');
      });

      it('cant cancel without permission', async () => {
        await mockAuthorizer.setCanPerform(false);
        await expect(delayedCall.cancel()).to.be.revertedWith('Not Authorized');
      });
    });
  });
});
