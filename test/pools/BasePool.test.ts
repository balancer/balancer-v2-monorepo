import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { GeneralPool, PoolSpecializationSetting } from '../../lib/helpers/pools';
import { BigNumberish } from '../../lib/helpers/numbers';
import { deploySortedTokens, TokenList } from '../../lib/helpers/tokens';
import { sharedBeforeEach } from '../helpers/lib/sharedBeforeEach';

describe('BasePool', function () {
  let admin: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;

  let tokens: TokenList;
  let tokenAddreses: string[];

  before(async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);

    tokenAddreses = [];
    for (const symbol in tokens) {
      tokenAddreses.push(tokens[symbol].address);
    }
  });

  function deployBasePool(
    specialization: PoolSpecializationSetting,
    addresses: string[],
    swapFee: BigNumberish
  ): Promise<Contract> {
    return deploy('MockBasePool', {
      args: [vault.address, specialization, 'Balancer Pool Token', 'BPT', addresses, swapFee],
    });
  }

  describe('deployment', () => {
    it('registers a pool in the vault', async () => {
      const pool = await deployBasePool(GeneralPool, tokenAddreses, 0);
      const poolId = await pool.getPoolId();

      const [poolAddress, poolSpecialization] = await vault.getPool(poolId);
      expect(poolAddress).to.equal(pool.address);
      expect(poolSpecialization).to.equal(GeneralPool);
    });

    it('reverts if the tokens are not sorted', async () => {
      await expect(deployBasePool(GeneralPool, tokenAddreses.reverse(), 0)).to.be.revertedWith('UNSORTED_ARRAY');
    });
  });
});
