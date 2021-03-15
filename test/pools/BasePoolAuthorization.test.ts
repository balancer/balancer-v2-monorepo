import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import { PoolSpecializationSetting, GeneralPool, MinimalSwapInfoPool, TwoTokenPool } from '../../lib/helpers/pools';

import TokenList from '../helpers/models/tokens/TokenList';

describe('BasePoolAuthorization', function () {
  let authorizer: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  async function deployBasePool(specialization: PoolSpecializationSetting, authorizer: string): Promise<Contract> {
    const vault = await deploy('Vault', { args: [authorizer, 0, 0] });
    const tokens = await TokenList.create(specialization === TwoTokenPool ? 2 : 3, { sorted: true });
    const args = [authorizer, vault.address, specialization, 'Balancer Pool Token', 'BPT', tokens.addresses, 0, 0, 0];
    return deploy('MockBasePool', { args });
  }

  context('for a minimal swap info pool', () => {
    itHandlesPoolAuthorizationProperly(MinimalSwapInfoPool);
  });

  context('for a general pool', () => {
    itHandlesPoolAuthorizationProperly(GeneralPool);
  });

  context('for a two token pool', () => {
    itHandlesPoolAuthorizationProperly(TwoTokenPool);
  });

  function itHandlesPoolAuthorizationProperly(specialization: PoolSpecializationSetting) {
    let pool: Contract;

    describe('authorizer', () => {
      it('has an initial authorizer', async () => {
        const pool = await deployBasePool(specialization, authorizer.address);

        expect(await pool.getAuthorizer()).to.equal(authorizer.address);
      });

      it('can be initialized to the zero address', async () => {
        const pool = await deployBasePool(specialization, ZERO_ADDRESS);

        expect(await pool.getAuthorizer()).to.equal(ZERO_ADDRESS);
      });
    });

    describe('change authorizer', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployBasePool(specialization, authorizer.address);
      });

      context('when the sender is has the role to do it', () => {
        let roleId: string;

        sharedBeforeEach('grant permission', async () => {
          roleId = await pool.CHANGE_POOL_AUTHORIZER_ROLE();
          await authorizer.connect(admin).grantRole(roleId, admin.address);
        });

        it('can change the authorizer to another address', async () => {
          expect(await pool.canChangeAuthorizer(admin.address)).to.be.true;

          await pool.connect(admin).changeAuthorizer(other.address);

          expect(await pool.getAuthorizer()).to.equal(other.address);
        });

        it('can change the authorizer to the zero address', async () => {
          expect(await pool.canChangeAuthorizer(admin.address)).to.be.true;

          await pool.connect(admin).changeAuthorizer(ZERO_ADDRESS);

          expect(await pool.getAuthorizer()).to.equal(ZERO_ADDRESS);
        });

        it('can not change the authorizer if the role was revoked', async () => {
          await authorizer.connect(admin).revokeRole(roleId, admin.address);

          expect(await pool.canChangeAuthorizer(admin.address)).to.be.false;

          await expect(pool.connect(admin).changeAuthorizer(other.address)).to.be.revertedWith(
            'SENDER_CANNOT_CHANGE_AUTHORIZER'
          );
        });
      });

      context('when the sender does not have the role to do it', () => {
        it('reverts', async () => {
          await expect(pool.connect(other).changeAuthorizer(other.address)).to.be.revertedWith(
            'SENDER_CANNOT_CHANGE_AUTHORIZER'
          );
        });
      });
    });
  }
});
