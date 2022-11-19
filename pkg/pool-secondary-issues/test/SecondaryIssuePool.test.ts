import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, MAX_UINT96, ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
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
      await expect(pool.initialize()).to.be.revertedWith('UNHANDLED_BY_SECONDARY_POOL');
    });
  });

  describe('swaps', () => {
    let currentBalances: BigNumber[];
    let params: {};

    sharedBeforeEach('deploy and initialize pool', async () => {

      await deployPool({ securityToken, currencyToken }, true);

      await setBalances(pool, { securityBalance: fp(20), currencyBalance: fp(35), bptBalance: MAX_UINT112 });
      
      const poolId = await pool.getPoolId();
      currentBalances = (await pool.vault.getPoolTokens(poolId)).balances;

      params = {
        fee: POOL_SWAP_FEE_PERCENTAGE,
      };
    });

    const setBalances = async (
      pool: SecondaryPool,
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
   

    context('Placing Market order', () => {
      let sell_amount: BigNumber;
      let buy_amount: BigNumber;
      let sell_price: BigNumber;
      let buy_price: BigNumber;


      sharedBeforeEach('initialize values ', async () => {
        sell_amount = fp(10); // sell qty
        buy_amount = fp(15); // buy qty
        buy_price = fp(14); // Buying price
        sell_price = fp(12); // Selling price
      });
      
      it('accepts sell order: BuyOrder > SellOrder', async () => {

        const sell_order = await pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_amount,
          balances: currentBalances,
          from: lp,
          recipient: lp,
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')) // MarketOrder Sell 10@market price
        });

        const buy_order = await pool.swapGivenIn({
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_amount,
          balances: currentBalances,
          // from: trader,
          // recipient: trader,
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')) // MarketOrder Buy 15@market price
        });

        const afterSwapBalanceCurrency = await currencyToken.balanceOf(lp);
        const afterSwapBalancesSecurity = await securityToken.balanceOf(trader);
        
        expect(afterSwapBalanceCurrency.toString()).to.be.equals(fp(140).toString());
        expect(afterSwapBalancesSecurity.toString()).to.be.equals(sell_amount.toString());
        
      });

      context('when pool paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });
        it('reverts', async () => {
          await expect(
            pool.swapGivenOut({
              in: pool.currencyIndex,
              out: pool.securityIndex,
              amount: buy_amount,
              balances: currentBalances,
            })
          ).to.be.revertedWith('PAUSED');
        });
      });
    });

    context('Placing Limit order', () => {
      let sell_amount: BigNumber;
      let buy_amount: BigNumber;
      let sell_price: BigNumber;
      let buy_price: BigNumber;

      sharedBeforeEach('initialize values ', async () => {
        sell_amount = fp(10); //qty
        buy_amount = fp(15); //qty
        buy_price = fp(12); // Buying price
        sell_price = fp(12); // Selling price
      });
      
      it('accepts Buy Order: SellOrder > BuyOrder', async () => {
        const sell_order = await pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_amount,
          balances: currentBalances,
          // from: lp,
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())) // Limit Order Sell@price12
        });

        const buy_order = await pool.swapGivenIn({
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_amount,
          balances: currentBalances,
          // from: trader,
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('6Market' + buy_price.toString())) // MarketOrder Buy@price12
        });

        const afterSwapBalanceCurrency = await currencyToken.balanceOf(lp);
        const afterSwapBalancesSecurity = await securityToken.balanceOf(trader);
        
        expect(afterSwapBalanceCurrency.toString()).to.be.equals(fp(120).toString());
        expect(afterSwapBalancesSecurity.toString()).to.be.equals(sell_amount.toString());

        // const postPaidCurrencyBalance = currentBalances[pool.currencyIndex].add(buy_amount);
        // const request_amount = postPaidCurrencyBalance.div(currentBalances[pool.securityIndex])

      });

      context('when pool paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });
        it('reverts', async () => {
          await expect(
            pool.swapGivenOut({
              in: pool.currencyIndex,
              out: pool.securityIndex,
              amount: buy_amount,
              balances: currentBalances,
            })
          ).to.be.revertedWith('PAUSED');
        });
      });
    });


  context('Placing Stop Loss order', () => {
    let sell_amount: BigNumber;
    let buy_amount: BigNumber;
    let buy_price: BigNumber;
    let sell_price: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_amount = fp(10); //qty
      buy_amount = fp(25); //qty
      buy_price = fp(12); // Buying price
      sell_price = fp(12); // Selling price
    });
    
    it('accepts sell order', async () => {
      const stop_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_amount,
        balances: currentBalances,
        // from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())) // Stop Order Sell@price12
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_amount,
        balances: currentBalances,
        // from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('6Market' + buy_price.toString())) // MarketOrder Buy@price12
      });

      const afterSwapBalanceCurrency = await currencyToken.balanceOf(lp);
      const afterSwapBalancesSecurity = await securityToken.balanceOf(trader);
      
      expect(afterSwapBalanceCurrency.toString()).to.be.equals(fp(120).toString());
      expect(afterSwapBalancesSecurity.toString()).to.be.equals(sell_amount.toString());

      // const postPaidCurrencyBalance = currentBalances[pool.currencyIndex].add(buy_amount);
      // const request_amount = postPaidCurrencyBalance.div(currentBalances[pool.securityIndex])

      // expect(buy_order.toString()).to.be.equals(request_amount.toString());
    });

    context('when pool paused', () => {
      sharedBeforeEach('pause pool', async () => {
        await pool.pause();
      });
      it('reverts', async () => {
        await expect(
          pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: buy_amount,
            balances: currentBalances,
          })
        ).to.be.revertedWith('PAUSED');
      });
    });

  });

  context('Placing Edit Order Request', () => {
    let sell_amount: BigNumber;
    let buy_amount: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_amount = BigNumber.from("10"); //qty
      buy_amount = BigNumber.from("25"); //qty
    });
    
    it('accepts edited order', async () => {
      const stop_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_amount,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit12')) // Stop Order Sell@price12
      });

      const _ref = await pool.getOrderRef();

      const edit_order = await pool.editOrder({
        ref: _ref[0].toString(),
        price: BigNumber.from("25"), //Changed price from 12 --> 25
        amount: buy_amount //Changed Qty from 10 --> 25
      });

      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_amount, //Qty 25
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('6Market25')) // MarketOrder Buy@price12
      });

      const postPaidCurrencyBalance = currentBalances[pool.currencyIndex].add(buy_amount);
      const request_amount = postPaidCurrencyBalance.div(currentBalances[pool.securityIndex])

      expect(buy_order.toString()).to.be.equals(request_amount.toString());
      
    });
  });

  context('Placing Cancel Order Request', () => {
    let sell_amount: BigNumber;
    let buy_amount: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_amount = BigNumber.from("10"); //qty
      buy_amount = BigNumber.from("25"); //qty
    });
    
    it('order cancelled', async () => {

      const stop_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_amount,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit12')) // Stop Order Sell@price12
      });

      const _ref = await pool.getOrderRef();

      const cancel_order = await pool.cancelOrder({
        ref: _ref[0].toString()
      });

      const _refAfterCancell = await pool.getOrderRef();
      expect(_refAfterCancell[0]).to.be.equals(ZERO_BYTES32);

      
    });
  });
});

  describe('joins and exits', () => {
    sharedBeforeEach('deploy pool', async () => {
      await deployPool({ securityToken, currencyToken }, false);
      await pool.initialize();
    });

    it('regular joins should revert', async () => {
      const { tokens: allTokens } = await pool.getTokens();

      const tx = pool.vault.joinPool({
        poolAddress: pool.address,
        poolId: await pool.getPoolId(),
        recipient: lp.address,
        tokens: allTokens,
        data: '0x',
      });

      await expect(tx).to.be.revertedWith('UNHANDLED_BY_SECONDARY_POOL');
    });

    it('regular exits should revert', async () => {
      const { tokens: allTokens } = await pool.getTokens();

      const tx = pool.vault.exitPool({
        poolAddress: pool.address,
        poolId: await pool.getPoolId(),
        recipient: lp.address,
        tokens: allTokens,
        data: '0x',
      });

      await expect(tx).to.be.revertedWith('UNHANDLED_BY_SECONDARY_POOL');
    });
  });
});
