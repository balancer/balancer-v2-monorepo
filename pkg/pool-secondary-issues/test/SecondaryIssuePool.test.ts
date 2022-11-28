import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, scaleDown } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { RawSecondaryPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/secondary-issue/types';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import SecondaryPool from '@balancer-labs/v2-helpers/src/models/pools/secondary-issue/SecondaryIssuePool';
import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";


describe('SecondaryPool', function () {
  let pool: SecondaryPool, tokens: TokenList, securityToken: Token, currencyToken: Token;
  let   trader: SignerWithAddress,
        lp: SignerWithAddress,
        admin: SignerWithAddress,
        owner: SignerWithAddress,
        other: SignerWithAddress;
  
  const TOTAL_TOKENS = 3;
  const SCALING_FACTOR = fp(1);
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const eventName = "CallSwap(IERC20,IERC20,uint256,uint256)";
  const eventType = ["IERC20 tokenIn", "IERC20 tokenOut", "uint256 securityTraded", "uint256 currencyTraded"];
  const encodedEventSignature = keccak256(toUtf8Bytes(eventName));

  const EXPECTED_RELATIVE_ERROR = 1e-14;

  before('setup', async () => {
    [, lp, trader, admin, owner, other] = await ethers.getSigners();
  });
  
  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['DAI', 'CDAI'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(500) });

    securityToken = tokens.DAI;
    currencyToken = tokens.CDAI;
  });
   
  async function deployPool(params: RawSecondaryPoolDeployment, mockedVault = true): Promise<any> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
    pool = await SecondaryPool.create(params, mockedVault);
    return pool;
  }
  const sellAmount=(qty: BigNumber, price: BigNumber)=>{
    return scaleDown(qty.mul(price), SCALING_FACTOR);
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
    let secondary_pool: any;

    sharedBeforeEach('deploy and initialize pool', async () => {

      secondary_pool = await deployPool({ securityToken, currencyToken }, true);

      await setBalances(pool, { securityBalance: fp(500), currencyBalance: fp(500), bptBalance: MAX_UINT112 });
      
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
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let sell_price: BigNumber;
    let buy_price: BigNumber;
    let beforeSwapLPCurrency: BigNumber;
    let beforeSwapLPSecurity: BigNumber;
    let beforeSwapTraderCurrency: BigNumber;
    let beforeSwapTraderSecurity: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(10); // sell qty
      buy_qty = fp(15); // buy qty
      buy_price = fp(14); // Buying price
      sell_price = fp(12); // Selling price
      beforeSwapLPCurrency = await currencyToken.balanceOf(lp);
      beforeSwapLPSecurity = await securityToken.balanceOf(lp);
      beforeSwapTraderCurrency = await currencyToken.balanceOf(trader);
      beforeSwapTraderSecurity = await securityToken.balanceOf(trader);
    });
    
    it('accepts Empty order: Sell Order@CMP > Buy Order@CMP', async () => {

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Sell 15@Market Price,
        eventHash: encodedEventSignature
      });
      
      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy 15@market price
        eventHash: encodedEventSignature
      });
      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);

        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });
          expect(sell_order_swap[0].toString()).to.be.equals("0");
            
          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")),  
          });

          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());
        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Market order: Sell Order@CMP > Buy Limit Order', async () => {
    
      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Sell 10@Market Price
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // LimitOrder Buy 15@210
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);
        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            balances: currentBalances,
            from: lp,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")) // MarketOrder Sell 15@Market Price
          });
          
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,buy_price).toString()); //20

          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            balances: currentBalances,
            from: trader,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")) // MarketOrder Buy 15@market price
          });

          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());
        }
      }else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Market order: Sell Order@CMP > Buy Stop Order', async () => {
    
      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Sell 15@Market Price
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + buy_price.toString())), // MarketOrder Buy 15@market price
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);
        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            balances: currentBalances,
            from: lp,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")) // MarketOrder Sell 15@Market Price
          });
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,buy_price).toString()); //20

          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            balances: currentBalances,
            from: trader,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")) // MarketOrder Buy 15@market price
          });

          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());
        }
      }else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    context('when pool paused', () => {
      sharedBeforeEach('pause pool', async () => {
        await pool.pause();
      });
      it('reverts', async () => {
        await expect(
          pool.swapGivenIn({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: buy_qty,
            balances: currentBalances,
          })
        ).to.be.revertedWith('PAUSED');
      });
    });
  });

  context('Placing Limit order', () => {
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let sell_price: BigNumber;
    let buy_price: BigNumber;
    let beforeSwapLPCurrency: BigNumber;
    let beforeSwapLPSecurity: BigNumber;
    let beforeSwapTraderCurrency: BigNumber;
    let beforeSwapTraderSecurity: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(10); //qty
      buy_qty = fp(15); //qty
      buy_price = fp(20); // Buying price
      sell_price = fp(12); // Selling price
      beforeSwapLPCurrency = await currencyToken.balanceOf(lp);
      beforeSwapLPSecurity = await securityToken.balanceOf(lp);
      beforeSwapTraderCurrency = await currencyToken.balanceOf(trader);
      beforeSwapTraderSecurity = await securityToken.balanceOf(trader);
    });
    
    it('Limit Order: Sell Limit Order > Buy Market Order', async () => {

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy@market price
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);
        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });

          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,sell_price).toString()); //20

          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self"))
          });

          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());
        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Limit Order: Sell Limit Order > Buy Limit Order', async () => {

      const sell_order= await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);

        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,buy_price).toString()); //20
          
          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self"))
          });


          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());

        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Limit Order: Sell Limit Order > Buy Stop Order', async () => {

      const sell_order= await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + buy_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);

        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,buy_price).toString()); //20
          
          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self"))
          });


          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());

        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    context('when pool paused', () => {
      sharedBeforeEach('pause pool', async () => {
        await pool.pause();
      });
      it('reverts', async () => {
        await expect(
          pool.swapGivenIn({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: buy_qty,
            balances: currentBalances,
          })
        ).to.be.revertedWith('PAUSED');
      });
    });
  });


  context('Placing Stop Loss order', () => {
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let buy_price: BigNumber;
    let sell_price: BigNumber;
    let beforeSwapLPCurrency: BigNumber;
    let beforeSwapLPSecurity: BigNumber;
    let beforeSwapTraderCurrency: BigNumber;
    let beforeSwapTraderSecurity: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(10); //qty
      buy_qty = fp(25); //qty
      buy_price = fp(20); // Buying price
      sell_price = fp(12); // Selling price
      beforeSwapLPCurrency = await currencyToken.balanceOf(lp);
      beforeSwapLPSecurity = await securityToken.balanceOf(lp);
      beforeSwapTraderCurrency = await currencyToken.balanceOf(trader);
      beforeSwapTraderSecurity = await securityToken.balanceOf(trader);
    });
    
    it('StopLoss order: Sell Stop Order > Buy Market Order', async () => {

      const stop_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())), // Stop Order Sell@price12
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy@CMP
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);

        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,sell_price).toString()); //20
          
          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self"))
          });

          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());
        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('StopLoss order: Sell Stop Order > Buy Limit Order', async () => {

      const sell_order_cmp = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // Buy Stop Order Buy@12
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);

        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,buy_price).toString()); //20
          
          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self"))
          });

          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());
        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('StopLoss order: Sell Stop Order > Buy Stop Order', async () => {

      const sell_order_cmp = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + buy_price.toString())), // Buy Stop Order Buy@12
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);

        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(sell_qty,buy_price).toString()); //20
          
          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self"))
          });

          expect(buy_order_swap[0].toString()).to.be.equals(sell_qty.toString());
        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    context('when pool paused', () => {
      sharedBeforeEach('pause pool', async () => {
        await pool.pause();
      });
      it('reverts', async () => {
        await expect(
          pool.swapGivenIn({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: buy_qty,
            balances: currentBalances,
          })
        ).to.be.revertedWith('PAUSED');
      });
    });

  });

  context('Placing Cancel Order Request', () => {
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let sell_price: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(10); //qty
      buy_qty = fp(25); //qty
      sell_price = fp(12); //qty
    });
    
    it('order cancelled', async () => {

      const stop_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit'+ sell_price.toString())) // Stop Order Sell@price12
      });

      const _ref = await pool.getOrderRef({from: lp});

      const cancel_order = await pool.cancelOrder({
        ref: _ref[0].toString(),
        from: lp
      });

      const _refAfterCancell = await pool.getOrderRef({from: lp});
      expect(_refAfterCancell[0]).to.be.equals(ZERO_BYTES32);
      
    });
  });

  context('Placing Edit Order Request', () => {
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let buy_price: BigNumber;
    let sell_price: BigNumber;
    let editedAmount: BigNumber;
    let editedPrice: BigNumber;
    let beforeSwapLPCurrency: BigNumber;
    let beforeSwapLPSecurity: BigNumber;
    let beforeSwapTraderCurrency: BigNumber;
    let beforeSwapTraderSecurity: BigNumber;


    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(10); //qty
      buy_qty = fp(25); //qty
      buy_price = fp(25); // Buying price
      sell_price = fp(12); // Selling price
      editedAmount = fp(12);
      editedPrice = fp(18);
      beforeSwapLPCurrency = await currencyToken.balanceOf(lp);
      beforeSwapLPSecurity = await securityToken.balanceOf(lp);
      beforeSwapTraderCurrency = await currencyToken.balanceOf(trader);
      beforeSwapTraderSecurity = await securityToken.balanceOf(trader);
    });
    
    it('accepts edited order', async () => {
      const stop_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // Stop Order Sell@price12
        eventHash: encodedEventSignature
      });

      const _ref = await pool.getOrderRef({from: lp});

      const edit_order = await pool.editOrder({
        ref: _ref[0].toString(),
        price: editedPrice, //Changed price from 12[selling price] --> 18[buying price]
        amount: editedAmount, //Changed Qty from 10[sell amount] --> 12[buy amount]
        from: lp
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty, //Qty 25
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy@CMP
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,buy_order[1]);

        if(eventEncodedData.orderType == "buySwap")
        {
          const sell_order_swap = await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: eventEncodedData.currencyTraded,
            from: lp,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self")), 
          });
          expect(sell_order_swap[0].toString()).to.be.equals(sellAmount(editedAmount,editedPrice).toString()); //20
          
          const buy_order_swap = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: eventEncodedData.securityTraded,
            from: trader,
            balances: currentBalances,
            data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("self"))
          });

          expect(buy_order_swap[0].toString()).to.be.equals(editedAmount.toString());
        }
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
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
