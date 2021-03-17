import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { MONTH } from '../../lib/helpers/time';
import { deploy } from '../../lib/helpers/deploy';
import { roleId } from '../../lib/helpers/roles';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';

describe('Vault', function () {
  let authorizer: Contract, vault: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;

  before(async () => {
    [, admin, other] = await ethers.getSigners();
  });

  describe('emergency period', () => {
    const EMERGENCY_PERIOD = MONTH * 3;
    const EMERGENCY_PERIOD_CHECK_EXTENSION = MONTH;

    sharedBeforeEach(async () => {
      authorizer = await deploy('Authorizer', { args: [admin.address] });
      vault = await deploy('Vault', {
        args: [authorizer.address, ZERO_ADDRESS, EMERGENCY_PERIOD, EMERGENCY_PERIOD_CHECK_EXTENSION],
      });
    });

    context('when the sender is has the role to do it', () => {
      let role: string;

      sharedBeforeEach('grant permission', async () => {
        role = roleId(vault, 'setEmergencyPeriod');
        await authorizer.connect(admin).grantRole(role, admin.address);
      });

      it('can change the emergency period status', async () => {
        expect(await authorizer.hasRole(role, admin.address)).to.be.true;

        await vault.connect(admin).setEmergencyPeriod(true);

        const { active } = await vault.getEmergencyPeriod();
        expect(active).to.be.true;
      });

      it('can not change the emergency period if the role was revoked', async () => {
        await authorizer.connect(admin).revokeRole(role, admin.address);

        expect(await authorizer.hasRole(role, admin.address)).to.be.false;

        await expect(vault.connect(admin).setEmergencyPeriod(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the role to do it', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).setEmergencyPeriod(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
