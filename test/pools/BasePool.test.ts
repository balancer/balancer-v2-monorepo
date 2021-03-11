import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '../helpers/models/tokens/TokenList';
import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish } from '../../lib/helpers/numbers';
import { GeneralPool, PoolSpecializationSetting } from '../../lib/helpers/pools';

describe('BasePool', function () {
  let admin: SignerWithAddress;
  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList;

  before(async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
  });

  function deployBasePool(
    specialization: PoolSpecializationSetting,
    addresses: string[],
    swapFee: BigNumberish
  ): Promise<Contract> {
    return deploy('MockBasePool', {
      args: [authorizer.address, vault.address, specialization, 'Balancer Pool Token', 'BPT', addresses, swapFee],
    });
  }

  describe('deployment', () => {
    it('registers a pool in the vault', async () => {
      const pool = await deployBasePool(GeneralPool, tokens.addresses, 0);
      const poolId = await pool.getPoolId();

      const [poolAddress, poolSpecialization] = await vault.getPool(poolId);
      expect(poolAddress).to.equal(pool.address);
      expect(poolSpecialization).to.equal(GeneralPool);
    });

    it('reverts if the tokens are not sorted', async () => {
      await expect(deployBasePool(GeneralPool, tokens.addresses.reverse(), 0)).to.be.revertedWith('UNSORTED_ARRAY');
    });
  });
});
