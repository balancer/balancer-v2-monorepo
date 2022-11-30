import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, decimal, fp, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { MAX_UINT112, MAX_UINT96 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { PoolSpecialization, BalancerErrorCodes, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
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
  
  const minimumPrice = fp(0.5);
  const basePrice = fp(5);
  const maxSecurityOffered = fp(100);
  const issueCutoffTime = BigNumber.from("1672444800");
  const offeringDocs = "0xB45165ED3CD437B9FFAD02A2AAD22A4DDC69162470E2622982889CE5826F6E3D";

  const EXPECTED_RELATIVE_ERROR = 1e-14;
  const _DEFAULT_MINIMUM_BPT = 1e6;
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

      it('registers tokens and bpt in the vault', async () => {
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
        expect(await pool.name()).to.equal('Balancer Pool Token');
      });

      it('sets the symbol', async () => {
        expect(await pool.symbol()).to.equal('BPT');
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
      await deployPool({securityToken, currencyToken, minimumPrice, basePrice, maxSecurityOffered, issueCutoffTime, offeringDocs}, false);
    });

    it('adds bpt to the owner', async () => {
      const previousBalances = await pool.getBalances();
      expect(previousBalances).to.be.zeros;

      await pool.initialize();
      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.bptIndex]).to.be.equal(0);
      expect(currentBalances[pool.securityIndex]).to.be.equal(0);
      expect(currentBalances[pool.currencyIndex]).to.be.equal(0);

      const ownerBalance = await pool.balanceOf(owner);
      expect(ownerBalance.toString()).to.be.equal(MAX_UINT112.sub(_DEFAULT_MINIMUM_BPT));
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
      await expect(pool.initialize()).to.be.revertedWith('UNHANDLED_BY_PRIMARY_POOL');
    });
    
  });

  describe('swaps', () => {
    let currentBalances: BigNumber[];
    let params: math.Params;

    sharedBeforeEach('deploy and initialize pool', async () => {

      await deployPool({ securityToken, currencyToken, minimumPrice, basePrice, maxSecurityOffered, issueCutoffTime, offeringDocs }, true);
      await pool.instance.setTotalSupply(MAX_UINT112);

      await setBalances(pool, { securityBalance: fp(100), currencyBalance: fp(100), bptBalance: MAX_UINT112 });
      
      const poolId = await pool.getPoolId();
      currentBalances = (await pool.vault.getPoolTokens(poolId)).balances;

      params = {
        fee: POOL_SWAP_FEE_PERCENTAGE,
        minPrice : minimumPrice,
        maxPrice : basePrice,
      };
    });

    const setBalances = async (
      pool: PrimaryPool,
      balances: { securityBalance?: BigNumber; currencyBalance?: BigNumber; bptBalance?: BigNumber }
    ) => {

      const updateBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) =>
        i == pool.securityIndex
          ? balances.securityBalance ?? bn(0)
          : i == pool.currencyIndex
          ? balances.currencyBalance ?? bn(0)
          : i == pool.bptIndex
          ? balances.bptBalance ?? bn(0)
          : bn(0)
      );
      const poolId = await pool.getPoolId();
      await pool.vault.updateBalances(poolId, updateBalances);
    };
   

    context('given security in', () => {
      let amount: BigNumber;
      let bptSupply: BigNumber;

      sharedBeforeEach('initialize values ', async () => {
        amount = fp(30);
        bptSupply = MAX_UINT112.sub(currentBalances[pool.bptIndex]);
      });
      
      it('Invalid Token', async () => {
        await expect( pool.swapGivenOut({
          in: pool.securityIndex,
          out: pool.securityIndex,
          amount: amount,
          balances: currentBalances,
        })).to.be.revertedWith("INVALID_TOKEN");
      });
      
      it('calculate currency out', async () => {
        const expected = math.calcCashOutPerSecurityIn(
          amount,
          currentBalances[pool.securityIndex],
          currentBalances[pool.currencyIndex],
          params
        );

        if ( Number(expected) === 0 ){
          await expect( pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: amount,
            balances: currentBalances,
          })).to.be.revertedWith("Price out of bound");
        }
        else{
          const result = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: amount,
            balances: currentBalances,
          });

          expect(Number(fromFp(result))).to.be.equals(Number(expected));
        }
        
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

    context('given cash in', () => {
      let amount: BigNumber;
      let bptSupply: BigNumber;

      sharedBeforeEach('initialize values ', async () => {
        amount = fp(25);
        bptSupply = MAX_UINT112.sub(currentBalances[pool.bptIndex]);
      });
      
      it('calculate security out', async () => {

        const expected = math.calcSecurityOutPerCashIn(
          amount,
          currentBalances[pool.securityIndex],
          currentBalances[pool.currencyIndex],
          params
        );

        if ( Number(expected) === 0 ){
          await expect( pool.swapGivenIn({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: amount,
            balances: currentBalances,
          })).to.be.revertedWith("Price out of bound");
        }
        else{
          const result = await pool.swapGivenIn({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: amount,
            balances: currentBalances,
          });

          expect(Number(fromFp(result))).to.be.equals(Number(expected));
        }
      });

      context('when paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        it('reverts', async () => {
          await expect(
            pool.swapGivenIn({
              in: pool.currencyIndex,
              out: pool.securityIndex,
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
        amount = fp(10);
      });
      
      it('calculate currency in', async () => {

        const expected = math.calcCashInPerSecurityOut(amount, 
          currentBalances[pool.securityIndex], 
          currentBalances[pool.currencyIndex],
          params);

        if ( Number(expected) === 0 ){
          await expect( pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: amount,
            balances: currentBalances,
          })).to.be.revertedWith("Price out of bound");
        }
        else if ( Number(expected) === 1 ){
          await expect( pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: amount,
            balances: currentBalances,
          })).to.be.revertedWith("Insufficient balance");
        }
        else{
          const result = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: amount,
            balances: currentBalances,
          });
  
          expect(Number(fromFp(result))).to.be.equals(Number(expected));
        }
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

    context('given cash out', () => {
      let amount: BigNumber;

      sharedBeforeEach('initialize values ', async () => {
        amount = fp(10);
      });

      it('calculate security in', async () => {

        const expected = math.calcSecurityInPerCashOut(amount, 
          currentBalances[pool.securityIndex], 
          currentBalances[pool.currencyIndex],
          params);

        if (Number(expected) === 0){
          await expect( pool.swapGivenOut({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: amount,
            balances: currentBalances,
          })).to.be.revertedWith("Price out of bound");
        }
        else if(Number(expected) === 1){
          await expect( pool.swapGivenOut({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: amount,
            balances: currentBalances,
          })).to.be.revertedWith("Insufficient balance");
        }
        else{
          const result = await pool.swapGivenOut({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: amount,
            balances: currentBalances,
          });
          expect(Number(fromFp(result))).to.be.equals(Number(expected));
        }

        
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

  describe('joins and exits', () => {
    sharedBeforeEach('deploy pool', async () => {
        await deployPool({securityToken, currencyToken, minimumPrice, basePrice, maxSecurityOffered, issueCutoffTime, offeringDocs }, false);
        await pool.initialize();
        // await setBalances(pool, { securityBalance: fp(200), currencyBalance: fp(200), bptBalance: fp(0) });
      });

      const setBalances = async (
        pool: PrimaryPool,
        balances: { securityBalance?: BigNumber; currencyBalance?: BigNumber; bptBalance?: BigNumber }
      ) => {
  
        const updateBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) =>
          i == pool.securityIndex
            ? balances.securityBalance ?? bn(0)
            : i == pool.currencyIndex
            ? balances.currencyBalance ?? bn(0)
            : i == pool.bptIndex
            ? balances.bptBalance ?? bn(0)
            : bn(0)
        );
        const poolId = await pool.getPoolId();
        await pool.vault.updateBalances(poolId, updateBalances);
      };

    it('regular joins should revert', async () => {
      const { tokens: allTokens } = await pool.getTokens();
      
      const tx = pool.vault.joinPool({
        poolAddress: pool.address,
        poolId: await pool.getPoolId(),
        recipient: lp.address,
        tokens: allTokens,
        data: '0x',
        });
      
      await expect(tx).to.be.revertedWith('UNHANDLED_BY_PRIMARY_POOL');
    });
    
    it('regular exits should revert', async () => {
      it('reverts', async () => {
        await expect(pool.exitPool()).to.be.revertedWith('NOT_PAUSED');
      }); 
    });

    context('when paused for emergency proportional exit', () => {
      it('gives back tokens', async () => {
          const beforeExitOwnerBalance = await pool.balanceOf(owner);
          const previousBalances = await pool.getBalances();
          const previousSecurityBalance = previousBalances[pool.securityIndex];
          const previousCurrencyBalance = previousBalances[pool.currencyIndex];
          const securityTokenBalanceBefore = await securityToken.balanceOf(owner);
          const currencyTokenBalanceBefore = await currencyToken.balanceOf(owner);
          const { tokens: allTokens } = await pool.getTokens();

          // await pool.exitPool();
          const minAmountsOut = new Array(tokens.length);
          const poolId = await pool.getPoolId();

          // await pool.vault.updateBalances(poolId, [fp(200),fp(0),fp(200)]);
      
          minAmountsOut[pool.securityIndex] = maxSecurityOffered;
          minAmountsOut[pool.currencyIndex] = maxSecurityOffered.div(basePrice);
          minAmountsOut[pool.bptIndex] = 0;

          console.log("minAmountsOut",minAmountsOut);
          console.log ("getPoolTokens", await pool.vault.getPoolTokens(poolId));
          const tx = await pool.vault.exitPool({
            poolAddress: pool.address,
            poolId: poolId,
            from: owner,
            recipient: owner.address,
            tokens: allTokens,
            minAmountsOut: minAmountsOut,
            toInternalBalance: false,
            protocolFeePercentage: 0,
            data: WeightedPoolEncoder.exitExactBPTInForTokensOut(MAX_UINT112.sub(_DEFAULT_MINIMUM_BPT)),
            });

          const afterExitOwnerBalance = await pool.balanceOf(owner);
          console.log("afterExitOwnerBalance",afterExitOwnerBalance.toString());
          const currentBalances = await pool.getBalances();
          const securityTokenBalanceAfter = await securityToken.balanceOf(owner);
          const currencyTokenBalanceAfter = await currencyToken.balanceOf(owner);
          // console.log("securityTokenBalanceAfter",securityTokenBalanceAfter);
          // console.log("securityTokenBalanceAfter",securityTokenBalanceAfter);

          expect(currentBalances[pool.bptIndex]).to.be.equal(0);
          expect(currentBalances[pool.securityIndex]).to.be.equal(0);
          expect(currentBalances[pool.currencyIndex]).to.be.equal(0);
          expect(securityTokenBalanceAfter).to.be.equal(securityTokenBalanceBefore.add(previousSecurityBalance));
          expect(currencyTokenBalanceAfter).to.be.equal(currencyTokenBalanceBefore.add(previousCurrencyBalance));
          expect(afterExitOwnerBalance).to.be.equal(beforeExitOwnerBalance.sub(MAX_UINT112));
        }); 
    });
  })


  describe('issueCutoffTime and price check', () => {
    let currentBalances: BigNumber[];
    sharedBeforeEach('deploy pool', async () => {
      await deployPool({ securityToken, currencyToken, minimumPrice, basePrice, maxSecurityOffered, issueCutoffTime, offeringDocs }, false);
      await pool.initialize();
      const poolId = await pool.getPoolId();
      currentBalances = (await pool.vault.getPoolTokens(poolId)).balances;
    });

    context('checks issueCutoffTime', () => {
      sharedBeforeEach('pause pool', async () => {
        const time = issueCutoffTime.add(issueCutoffTime);
        advanceTime(time);
      });

      it('reverts', async () => {
        await expect(
          pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: BigNumber.from("4"),
            balances: currentBalances,
          })
        ).to.be.revertedWith('TimeLimit Over');
      });
    });


    it('checks minimum price', async () => {
      expect(await pool.getminimumPrice()).to.equal(minimumPrice);
    });

    it('checks maximum price', async () => {
      expect(await pool.getbasePrice()).to.equal(basePrice);
    });
  });
  
});
