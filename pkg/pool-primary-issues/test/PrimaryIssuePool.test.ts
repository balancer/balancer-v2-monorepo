import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, MAX_UINT96 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { PoolSpecialization, BalancerErrorCodes } from '@balancer-labs/balancer-js';
import { RawPrimaryPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/primary-issue/types';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import PrimaryPool from '@balancer-labs/v2-helpers/src/models/pools/primary-issue/PrimaryIssuePool';

import * as math from './math';
import Decimal from 'decimal.js';

describe('PrimaryPool', function () {
  let pool: PrimaryPool, tokens: TokenList, securityToken: Token, currencyToken: Token;
  let trader: SignerWithAddress,
    lp: SignerWithAddress,
    admin: SignerWithAddress,
    owner: SignerWithAddress,
    other: SignerWithAddress;

  const TOTAL_TOKENS = 3;
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  
  const minimumPrice = BigNumber.from("5");
  const basePrice = BigNumber.from("10");
  const maxSecurityOffered = BigNumber.from("100");
  const issueCutoffTime = BigNumber.from("1672444800");

  const EXPECTED_RELATIVE_ERROR = 1e-14;
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  function testAllEqualTo(arr: BigNumber[], val: BigNumberish) {
    for (let i = 0; i < arr.length; i++) if (!arr[i].eq(val)) return false;
    return true;
  }

  before('setup', async () => {
    [, lp, trader, admin, owner, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['DAI', 'CDAI'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    securityToken = tokens.DAI;
    currencyToken = tokens.CDAI;
  });

  async function deployPool(params: RawPrimaryPoolDeployment, mockedVault = true): Promise<void> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
    pool = await PrimaryPool.create(params, mockedVault);
  }

  describe('creation', () => {
    context('when the creation succeeds', () => {
      sharedBeforeEach('deploy pool', async () => {
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
        expect(testAllEqualTo(balances, 0)).to.be.equal(true);
      });

      it('sets the asset managers', async () => {
        await tokens.asyncEach(async (token) => {
          const { assetManager } = await pool.getTokenInfo(token);
          expect(assetManager).to.be.equal(ZERO_ADDRESS);
        });
      });

      it('sets swap fee', async () => {
        expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
      });

      it('sets the name', async () => {
        expect(await pool.name()).to.equal('DAI');
      });

      it('sets the symbol', async () => {
        expect(await pool.symbol()).to.equal('DAI');
      });

      it('sets the decimals', async () => {
        expect(await pool.decimals()).to.equal(18);
      });
      
    });

    context('when the creation fails', () => {
      it('reverts if there are repeated tokens', async () => {
        await expect(
          deployPool({ securityToken, currencyToken: securityToken }, false)
        ).to.be.revertedWith(BalancerErrorCodes.UNSORTED_ARRAY.toString());
      });
    });
  });
  
  describe('initialization', () => {
    sharedBeforeEach('deploy pool', async () => {
      await deployPool({securityToken, currencyToken, minimumPrice, basePrice, maxSecurityOffered, issueCutoffTime}, false);
    });
    
    it('initialize pool', async () => {
      const previousBalances = await pool.getBalances();
      expect(previousBalances).to.be.zeros;

      await pool.initialize();

      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.bptIndex]).to.be.equal(MAX_UINT112);
      expect(currentBalances[pool.securityIndex]).to.be.equal(0);
      expect(currentBalances[pool.currencyIndex]).to.be.equal(0);

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
  /*
  describe('swaps', () => {
    let currentBalances: BigNumber[];
    let params: math.Params;

    sharedBeforeEach('deploy and initialize pool', async () => {

      await deployPool({ securityToken, currencyToken, minimumPrice, basePrice, maxSecurityOffered, issueCutoffTime }, true);
      currentBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) => (i == pool.bptIndex ? MAX_UINT112 : bn(0)));

      params = {
        fee: POOL_SWAP_FEE_PERCENTAGE,
        minPrice : minimumPrice,
        maxPrice : basePrice,
      };
    });

    context('given security in', () => {
      let amount: BigNumber;
      let bptSupply: BigNumber;

      sharedBeforeEach('initialize values ', async () => {
        amount = fp(100);
        bptSupply = MAX_UINT112.sub(currentBalances[pool.bptIndex]);
      });

      it('calculate bpt out', async () => {
        const result = await pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.bptIndex,
          amount: amount,
          balances: currentBalances,
        });

        const expected = math.calcBptOutPerSecurityIn(
          amount,
          currentBalances[pool.securityIndex],
          currentBalances[pool.currencyIndex],
          bptSupply,
          params
        );

        expect(result).to.be.equals(bn(expected));

        currentBalances[pool.securityIndex] = currentBalances[pool.securityIndex].add(amount);
        currentBalances[pool.bptIndex] = currentBalances[pool.bptIndex].sub(result);
      });

      context('when paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        it('reverts', async () => {
          await expect(
            pool.swapGivenIn({
              in: pool.securityIndex,
              out: pool.bptIndex,
              amount: amount,
              balances: currentBalances,
            })
          ).to.be.revertedWith('PAUSED');
        });
      });
    });

    context('given security out', () => {
      let amount: BigNumber;

      sharedBeforeEach('initialize values ', async () => {
        amount = fp(50);
      });

      it('calculate currency in', async () => {
        const result = await pool.swapGivenOut({
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: amount,
          balances: currentBalances,
        });

        const expected = math.calcCashInPerSecurityOut(amount, 
                                                      currentBalances[pool.securityIndex], 
                                                      currentBalances[pool.currencyIndex],
                                                      params);

        expect(result).to.be.equals(bn(expected));

        currentBalances[pool.currencyIndex] = currentBalances[pool.currencyIndex].add(amount);
        currentBalances[pool.securityIndex] = currentBalances[pool.securityIndex].sub(result);
      });

      context('when paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        it('reverts', async () => {
          await expect(
            pool.swapGivenOut({
              in: pool.currencyIndex,
              out: pool.securityIndex,
              amount: amount,
              balances: currentBalances,
            })
          ).to.be.revertedWith('PAUSED');
        });
      });
    });

    context('given security in', () => {
      let amount: BigNumber;

      sharedBeforeEach('initialize values ', async () => {
        amount = fp(10);
      });

      it('calculate currency out', async () => {
        const result = await pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: amount,
          balances: currentBalances,
        });

        const expected = math.calcSecurityInPerCashOut(amount, 
                                                      currentBalances[pool.currencyIndex], 
                                                      currentBalances[pool.securityIndex],
                                                      params);

        expect(result).to.be.equals(bn(expected));

        currentBalances[pool.securityIndex] = currentBalances[pool.securityIndex].add(amount);
        currentBalances[pool.currencyIndex] = currentBalances[pool.currencyIndex].sub(result);
      });

      context('when paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        it('reverts', async () => {
          await expect(
            pool.swapGivenIn({
              in: pool.securityIndex,
              out: pool.currencyIndex,
              amount: amount,
              balances: currentBalances,
            })
          ).to.be.revertedWith('PAUSED');
        });
      });
    });
  });
  */
});
