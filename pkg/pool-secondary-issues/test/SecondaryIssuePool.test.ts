import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, MAX_UINT96 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { RawSecondaryPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/secondary-issue/types';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import SecondaryPool from '@balancer-labs/v2-helpers/src/models/pools/secondary-issue/SecondaryIssuePool';

import Decimal from 'decimal.js';

describe('SecondaryPool', function () {
  let pool: SecondaryPool, tokens: TokenList, securityToken: Token, currencyToken: Token;
  let   trader: SignerWithAddress,
        lp: SignerWithAddress,
        admin: SignerWithAddress,
        owner: SignerWithAddress,
        other: SignerWithAddress;

  const TOTAL_TOKENS = 3;
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  const EXPECTED_RELATIVE_ERROR = 1e-14;

  before('setup', async () => {
    [, lp, trader, admin, owner, other] = await ethers.getSigners();
  });
  
  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['DAI', 'CDAI'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    securityToken = tokens.DAI;
    currencyToken = tokens.CDAI;
  });
  
  async function deployPool(params: RawSecondaryPoolDeployment, mockedVault = true): Promise<void> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
    pool = await SecondaryPool.create(params, mockedVault);
  }
  
  describe('creation', () => {
    context('when the creation succeeds', () => {
      let upperTarget: BigNumber;

      sharedBeforeEach('deploy pool', async () => {
        upperTarget = fp(2000);
        await deployPool({ securityToken, currencyToken }, false);
      });

      it('sets the vault', async () => {
        expect(await pool.getVault()).to.equal(pool.vault.address);
      });

      it('uses general specialization', async () => {
        const { address, specialization } = await pool.getRegisteredInfo();
        expect(address).to.equal(pool.address);
        expect(specialization).to.equal(PoolSpecialization.GeneralPool);
      });

      it('registers tokens in the vault', async () => {
        const { tokens, balances } = await pool.getTokens();

        expect(tokens).to.have.members(pool.tokens.addresses);
        expect(balances).to.be.zeros;
      });

      it('sets the asset managers', async () => {
        await tokens.asyncEach(async (token) => {
          const { assetManager } = await pool.getTokenInfo(token);
          expect(assetManager).to.be.zeroAddress;
        });
      });

      it('sets swap fee', async () => {
        expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
      });

      it('sets the name', async () => {
        expect(await pool.name()).to.equal('Verified Liquidity Token');
      });

      it('sets the symbol', async () => {
        expect(await pool.symbol()).to.equal('VITTA');
      });

      it('sets the decimals', async () => {
        expect(await pool.decimals()).to.equal(18);
      });

    });

    context('when the creation fails', () => {
      it('reverts if there are repeated tokens', async () => {
        await expect(deployPool({ securityToken, currencyToken: securityToken }, false)).to.be.revertedWith('UNSORTED_ARRAY');
      });

    });
  });
  
  describe('initialization', () => {
    sharedBeforeEach('deploy pool', async () => {
      await deployPool({ securityToken, currencyToken }, false);
    });

    it('initialize pool', async () => {
      const previousBalances = await pool.getBalances();
      expect(previousBalances).to.be.zeros;

      await pool.initialize();

      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.securityIndex]).to.be.equal(0);
      expect(currentBalances[pool.currencyIndex]).to.be.equal(0);

      expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
    });

    it('cannot be initialized outside of the initialize function', async () => {
      await expect(
        pool.vault.joinPool({
          poolId: await pool.getPoolId(),
          tokens: pool.tokens.addresses,
        })
      ).to.be.revertedWith('INVALID_INITIALIZATION');
    });

    it('cannot be initialized twice', async () => {
      await pool.initialize();
      await expect(pool.initialize()).to.be.revertedWith('UNHANDLED_JOIN_KIND');
    });
  });
  
});