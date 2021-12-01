import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { RawLinearPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/linear/types';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe.only('AaveLinearPool', function () {
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;
  let mockLendingPool: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, admin: SignerWithAddress, owner: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, admin, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    const [deployer] = await ethers.getSigners();

    mainToken = await Token.create('DAI');
    const wrappedTokenInstance = await deploy('MockStaticAToken', { args: [deployer.address, 'cDAI', 'cDAI', 18] });
    wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();
    mockLendingPool = wrappedTokenInstance;

    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  async function deployPool(params: RawLinearPoolDeployment, mockedVault = true): Promise<void> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
    pool = await LinearPool.create(params, mockedVault);
  }

  describe('getWrappedTokenRate', () => {
    sharedBeforeEach('deploy and initialize pool', async () => {
      await deployPool({ mainToken, wrappedToken }, true);
    });

    it('returns the expected value', async () => {
      // Reserve's normalised income is stored with 27 decimals (i.e. a 'ray' value)
      // 1e27 implies a 1:1 exchange rate between main and wrapped token
      await mockLendingPool.setReserveNormalizedIncome(bn(1e27));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

      // We now double the reserve's normalised income to change the exchange rate to 2:1
      await mockLendingPool.setReserveNormalizedIncome(bn(2e27));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
    });
  });
});
