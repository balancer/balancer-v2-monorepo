import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Bytes } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, scaleDown, scaleUp } from '@balancer-labs/v2-helpers/src/numbers';
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
  
  const maxCurrencyOffered = fp(5);
  const maxSecurityOffered = fp(5);
  const TOTAL_TOKENS = 3;
  const SCALING_FACTOR = fp(1);
  const _DEFAULT_MINIMUM_BPT = 1e6;
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  const abiCoder = new ethers.utils.AbiCoder();

  const EXPECTED_RELATIVE_ERROR = 1e-14;

  before('setup', async () => {
    [, lp, trader, admin, owner, other] = await ethers.getSigners();
  });
  
  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['DAI', 'CDAI'], { sorted: true });
    await tokens.mint({ to: [owner, lp, trader], amount: fp(500) });

    securityToken = tokens.DAI;
    currencyToken = tokens.CDAI;
  });
   
  async function deployPool(params: RawSecondaryPoolDeployment, mockedVault = true): Promise<any> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
    pool = await SecondaryPool.create(params, mockedVault);
    return pool;
  }
  const mulDown = (a: BigNumber, b: BigNumber)=>{
    return scaleDown(a.mul(b), SCALING_FACTOR);
  }

  const divDown = (a: BigNumber, b: BigNumber)=>{
    const aInflated = scaleUp(a, SCALING_FACTOR);
    return aInflated.div(b);
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
        // expect(balances).to.be.zeros;
      });

      it('sets the asset managers', async () => {
        await tokens.asyncEach(async (token) => {
          const { assetManager } = await pool.getTokenInfo(token);
          // expect(assetManager).to.be.zeroAddress;
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
    let maxAmountsIn: BigNumber[];
    let previousBalances: BigNumber[];

    sharedBeforeEach('deploy pool', async () => {
      await deployPool({securityToken, currencyToken }, false);
      await tokens.approve({ from: owner, to: pool.vault.address, amount: fp(500) });

      previousBalances = await pool.getBalances();

      maxAmountsIn = new Array(tokens.length);
      maxAmountsIn[pool.securityIndex] = maxSecurityOffered; 
      maxAmountsIn[pool.currencyIndex] = maxCurrencyOffered;
      maxAmountsIn[pool.bptIndex] = fp(0);

      await pool.init({ from: owner, recipient: owner.address, initialBalances: maxAmountsIn });
    });

    it('adds bpt to the owner', async () => {
      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.bptIndex]).to.be.equal(0);

      expect(currentBalances[pool.securityIndex]).to.be.equal(maxSecurityOffered);
      expect(currentBalances[pool.currencyIndex]).to.be.equal(maxCurrencyOffered);

      const ownerBalance = await pool.balanceOf(owner);
      expect(ownerBalance.toString()).to.be.equal(MAX_UINT112.sub(_DEFAULT_MINIMUM_BPT));
    });

    it('cannot be initialized twice', async () => {
      await expect(
        pool.init({ 
          from: owner, 
          recipient: owner.address, 
          initialBalances: maxAmountsIn 
        })).to.be.revertedWith('UNHANDLED_BY_SECONDARY_POOL');
    }); 
  });

  describe('swaps', () => {
    let currentBalances: BigNumber[];
    let params: {};
    let secondary_pool: any;
    let ob: any;

    sharedBeforeEach('deploy and initialize pool', async () => {

      secondary_pool = await deployPool({ securityToken, currencyToken }, true);

      await setBalances(pool, { securityBalance: fp(500), currencyBalance: fp(500), bptBalance: fp(0) });
      
      const poolId = await pool.getPoolId();
      currentBalances = (await pool.vault.getPoolTokens(poolId)).balances;
      ob = await pool.orderbook(); 
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
   
  const callSwapEvent = async(cpTradesInfo: any, pTradesInfo: any, securityTraded: BigNumber, currencyTraded: BigNumber, counterPartyOrder: string, partyOrder: string, partyOrderType?: string) => {
    //extract details of order
    const counterPartyOrderDetails = await ob.getOrder({from: lp, ref:cpTradesInfo.counterpartyRef});
    const partyOrderDetails = await ob.getOrder({from: trader, ref:pTradesInfo.partyRef});
    
    // for Counter Party
     const counterPartyTx = {
      in: counterPartyOrderDetails.tokenIn == "security" ? pool.securityIndex :  pool.currencyIndex,
      out:  partyOrderDetails.tokenIn != "security" ? pool.securityIndex :  pool.currencyIndex,
      amount: cpTradesInfo.dt,
      from: counterPartyOrderDetails.party == lp.address ? lp : trader,
      balances: currentBalances,
      data: abiCoder.encode(["string", "uint"], ['', cpTradesInfo.dt]),
    };
    // for Party  
    const partyDataTx = {
      in: partyOrderDetails.tokenIn == "security" ? pool.securityIndex :  pool.currencyIndex,
      out:  counterPartyOrderDetails.tokenIn != "security" ? pool.securityIndex :  pool.currencyIndex,
      amount: pTradesInfo.dt,
      from: partyOrderDetails.party == lp.address ? lp : trader,
      balances: currentBalances,
      data: abiCoder.encode(["string", "uint"], ['', pTradesInfo.dt]),
    };

    const counterPartyAmount = cpTradesInfo.counterpartySwapIn ?  await pool.swapGivenIn(counterPartyTx) :  await pool.swapGivenOut(counterPartyTx);
    const counterTradedAmount = counterPartyOrder == "Sell" ? securityTraded.toString() : currencyTraded.toString();
    const orderName = counterPartyOrder == "Sell" ? "Security Traded" : "Currency Traded";
    // console.log(orderName,counterTradedAmount);
    expect(counterPartyAmount[0].toString()).to.be.equals(counterTradedAmount); 

    if(partyOrderType != "Market")
    {
      const partyAmount = partyOrderDetails.tokenIn ?  await pool.swapGivenIn(partyDataTx) :  await pool.swapGivenOut(partyDataTx);
      const partyTradedAmount = partyOrder == "Sell" ? securityTraded.toString() : currencyTraded.toString();
      const orderName2 = partyOrder == "Sell" ? "Security Traded" : "Currency Traded";
      // console.log(orderName2,partyTradedAmount);
      expect(partyAmount[0].toString()).to.be.equals(partyTradedAmount); 
    }     
  } 
  
  context('Placing Market order', () => {
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let sell_price: BigNumber;
    let buy_price: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(20); // sell qty
      buy_qty = fp(500); // buy qty
      buy_price = fp(40); // Buying price
    });
    
    it('accepts Empty order: Sell Order@CMP > Buy Order@CMP', async () => {
      await expect(pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: abiCoder.encode([], []), // MarketOrder Sell 10@Market Price
         
      })).to.be.revertedWith("Insufficient liquidity");
      
      await expect(pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: lp,
        data: abiCoder.encode([], []), // MarketOrder Buy 500@Market Price
         
      })).to.be.revertedWith("Insufficient liquidity");

    });

    it('Market order: Sell Order@CMP > Buy Limit Order', async () => {
      const currencyTraded = mulDown(sell_qty,buy_price);
      const securityTraded = divDown(currencyTraded, buy_price);
      if(sell_qty > fp(0))
      {
        await expect(pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_qty,
          balances: currentBalances,
          from: lp,
          data: abiCoder.encode([], []), // MarketOrder Sell 10@Market Price
           
        })).to.be.revertedWith("Insufficient liquidity");
        return;
      }
      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data : ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // LimitOrder Buy 15@210
         
      });

      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy");

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

  context('Counter Party Sell Order > Party Buy Order', () => {
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let sell_price: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(20); //qty
      buy_qty = fp(500); //qty
      sell_price = fp(20); // Selling price
    });

    it('Sell SWAP IN Security Order > Buy SWAP IN Currency Order', async () => {
      const currencyTraded = mulDown(sell_qty,sell_price);
      const securityTraded = divDown(currencyTraded, sell_price);

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Sell@price12
         
      });

      if(buy_qty > sell_qty){
        await expect( pool.swapGivenIn({
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []), // MarketOrder Buy@market price
           
        })).to.be.revertedWith('Insufficient liquidity')
      }
    });

    it('Sell SWAP Out Currency Order > Buy SWAP IN Currency Order', async () => {
      sell_qty = fp(400);
      const currencyTraded = sell_qty;
      const securityTraded = divDown(currencyTraded, sell_price);

      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Sell@price12
         
      });

      if(buy_qty > sell_qty){
        await expect( pool.swapGivenIn({
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []), // MarketOrder Buy@market price
           
        })).to.be.revertedWith('Insufficient liquidity')
      }
    });

    it('Sell SWAP Out Currency Order > Buy SWAP OUT Security Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(20);
      const securityTraded = divDown(sell_qty,sell_price);
      const currencyTraded = mulDown(securityTraded,sell_price);

      const sell_order = await pool.swapGivenOut({ //Buy Currency or Sell Security
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Sell@price12
         
      });

      if(buy_qty > securityTraded)
      {
        await expect(pool.swapGivenOut({ //Buy Security or Sell Currency
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []), // MarketOrder Buy@market price
           
        })).to.be.revertedWith("Insufficient liquidity");
      }
      else{
        const buy_order = await pool.swapGivenOut({ //Buy Security or Sell Currency
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []), // MarketOrder Buy@market price
           
        });
        const counterPartyTrades = await ob.getTrades({from: lp});
        const partyTrades = await ob.getTrades({from: trader});

        const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
        const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
    
        await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy");
      
      }
      
    });

    it('Sell SWAP In Security Order > Buy SWAP OUT Security Order', async () => {
      sell_qty = fp(10);
      buy_qty = fp(5);
      const securityTraded = buy_qty;
      const currencyTraded = mulDown(securityTraded, sell_price);

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Sell@price12
         
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode([], []), // MarketOrder Buy@market price
         
      });
      expect(buy_order[0].toString()).to.be.equals(currencyTraded.toString()); 
  
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy","Market");
     
    });

    it('Sell SWAP Out Currency Order > Buy SWAP OUT Security Order2', async () => {
      sell_qty = fp(400);
      buy_qty = fp(10);
      const securityTraded = buy_qty;
      const currencyTraded = mulDown(securityTraded,sell_price);

      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Sell@price12
         
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode([], []), // MarketOrder Buy@market price
         
      });
      expect(buy_order[0].toString()).to.be.equals(currencyTraded.toString()); 
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy","Market");

    });

    it('Sell[Limit] SWAP In Security Order > Buy [Market] SWAP OUT Security Order', async () => {
      sell_qty = fp(40);
      buy_qty = fp(10);
      const securityTraded = buy_qty;
      const currencyTraded = mulDown(securityTraded,sell_price);

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Sell@price12
         
      });

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode([], []), // MarketOrder Buy@market price
         
      });

      expect(buy_order[0].toString()).to.be.equals(currencyTraded.toString()); 
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy","Market");

    });
  });

  context('Counter Party Buy Order > Party Sell Order', () => {
    let sell_qty: BigNumber;
    let buy_qty: BigNumber;
    let buy_price: BigNumber;
    let sell_price: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(20); //qty
      buy_qty = fp(300); //qty
      buy_price = fp(20); // Buy price
      sell_price = fp(10);
    });

    it('Buy SWAP IN Currency Order > Sell SWAP IN Security Order', async () => {
      const securityTraded = divDown(buy_qty, buy_price);
      const currencyTraded = mulDown(securityTraded,buy_price);

      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', buy_price]), // Limit Order Sell@price12
         
      });

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // MarketOrder Buy@market price
         
      });

      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell");
    
    });

    it('Buy[Limit] SWAP Out Security Order > Sell [Market] SWAP IN Security Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(10);
      const securityTraded = buy_qty;
      const currencyTraded = mulDown(buy_qty,buy_price);

      const buy_order = await pool.swapGivenOut({ //Buy Security
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', buy_price]), // Limit Order Buy@price 20
         
      });

      if(sell_qty > securityTraded)
      {
        await expect(pool.swapGivenIn({ // Sell Security
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []), 
           
        })).to.be.revertedWith("Insufficient liquidity");
      }
      else{ 
        const sell_order = await pool.swapGivenIn({ // Sell Security
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []), 
           
        });
  
    
        const counterPartyTrades = await ob.getTrades({from: lp});
        const partyTrades = await ob.getTrades({from: trader});

        const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
        const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
    
        await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell");

      }
      
    });

    it('Buy[Limit] SWAP IN Currency Order > Sell [Stop] SWAP IN Security Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(1000);
      const securityTraded = sell_qty;
      const currencyTraded = mulDown(securityTraded, buy_price);

      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', buy_price]), // Limit Order Buy@price 20
         
      });

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Stop', sell_price]), // Limit Sell@price 10
         
      });

      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell");
 
    });

    it('Buy SWAP Out Security Order > Sell SWAP IN Security Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(50);
      const securityTraded = sell_qty;
      const currencyTraded = mulDown(securityTraded, buy_price);
  
      const buy_order = await pool.swapGivenOut({
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_qty,
          from: lp,
          balances: currentBalances,
          data: abiCoder.encode(["string", "uint"], ['Limit', buy_price]), // Limit Order Buy@price 20
           
      });
  
      const sell_order = await pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode(["string", "uint"], ['Stop', sell_price]), // Limit Sell@price 10
           
      });
  
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell");
 
    });

    it('Sell SWAP In Currency Order > Buy SWAP In Currency Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(10);
      sell_price = fp(20);
      buy_price = fp(10);
      const currencyTraded = buy_qty;
      const securityTraded = divDown(currencyTraded, sell_price);
     
      const sell_order = await pool.swapGivenIn({ //Sell Currency
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_qty,
          from: lp,
          balances: currentBalances,
          data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Buy@price 20
           
      });
  
      const buy_order = await pool.swapGivenIn({ //Buy Security
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []),
           
      });

      expect(buy_order[0].toString()).to.be.equals(securityTraded.toString()); 
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy", "Market");

    });
  
    it('Buy SWAP Out Security Order > Sell SWAP Out Security Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(5);
      buy_price = fp(20);
      sell_price = fp(10);
      const currencyTraded = mulDown(buy_qty, buy_price);
      const securityTraded = divDown(currencyTraded,buy_price);
  
      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', buy_price]), // Limit Order Buy@price 20
         
      });
  
      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Stop', sell_price]), // Limit Sell@price 10
         
      });
  
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell");

    });

    it('Buy SWAP In Currency Order > Sell SWAP Out Currency Order', async () => {
      sell_qty = fp(50);
      buy_qty = fp(100);
      
      const currencyTraded = sell_qty;
      const securityTraded = divDown(currencyTraded,buy_price);

      const buy_order = await pool.swapGivenIn({ //BUY Curr[Sell Sec]
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Stop', buy_price]), // Stop Order Buy@price 20
         
      });

      const sell_order = await pool.swapGivenOut({ //Sell Currency[Buy Sec]
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Stop', sell_price]), // Stop Sell@price 10
         
      });
  
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});
      if(counterPartyTrades.length && partyTrades.length)
      {
        const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
        const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
    
        await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell");
      }
    });
  
    it('Buy SWAP Out Security Order > Sell SWAP Out Currency Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(100);
      const currencyTraded = sell_qty;
      const securityTraded = divDown(currencyTraded,buy_price);
      const buy_order = await pool.swapGivenOut({ //buy security 100
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Stop', buy_price]), // Limit Order Buy@price 20
         
      });
  
      const sell_order = await pool.swapGivenOut({ //buy currency [Sell Sec] 200
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode([], []), // Market
         
      });
      //console.log(sell_order[0].toString());
      expect(sell_order[0].toString()).to.be.equals(securityTraded.toString()); 
      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
      const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
  
      await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell","Market");
   
    });
  
    it('Buy SWAP IN Currency Order > Sell SWAP Out Security Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(500);
      const currencyTraded = sell_qty;
      const securityTraded = divDown(sell_qty,buy_price);
  
      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Stop', buy_price]),
      });
  
      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]),
      });

      const counterPartyTrades = await ob.getTrades({from: lp});
      const partyTrades = await ob.getTrades({from: trader});

      if(counterPartyTrades.length && partyTrades.length)
      {
        const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
        const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
        await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Buy","Sell");
      }
      
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
        data: abiCoder.encode(["string", "uint"], ['Stop', sell_price]),
         
      });

      const ob = await pool.orderbook(); 
      const _ref = await ob.getOrderRef({from: lp});

      const cancel_order = await ob.cancelOrder({
        ref: _ref[0].toString(),
        from: lp
      });

      const _refAfterCancell = await ob.getOrderRef({from: lp});
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


    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(20); //qty
      buy_qty = fp(500); //qty
      buy_price = fp(25); // Buying price
      sell_price = fp(20); // Selling price
      editedAmount = fp(12);
      editedPrice = fp(18);
    });
    
    it('accepts edited order', async () => {
      const currencyTraded = mulDown(sell_qty,sell_price);
      const securityTraded = divDown(currencyTraded, sell_price);

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', sell_price]), // Limit Order Sell@price12
         
      });
      
      const ob = await pool.orderbook();
      const _ref = await ob.getOrderRef({from: lp});

      const edit_order = await ob.editOrder({
        ref: _ref[0].toString(),
        price: sell_qty, //Changed price from 20[selling price] --> 20[buying price]
        amount: sell_price, //Changed Qty from 10[sell amount] --> 20[buy amount]
        from: lp
      });

      if(buy_qty > securityTraded)
      {
        await expect(pool.swapGivenIn({ 
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: buy_qty,
          from: trader,
          balances: currentBalances,
          data: abiCoder.encode([], []), // MarketOrder Buy@market price
           
        })).to.be.revertedWith("Insufficient liquidity");
      }
      else {
          const buy_order = await pool.swapGivenIn({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: buy_qty,
            from: trader,
            balances: currentBalances,
            data: abiCoder.encode([], []), // MarketOrder Buy@market price
             
          });
  
          const counterPartyTrades = await ob.getTrades({from: lp});
          const partyTrades = await ob.getTrades({from: trader});

          const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
          const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
      
          await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy");
        }
    });
  });

  context('Random OrderBook Testing', () => {
    [...Array(10).keys()].forEach(value => {
      let sell_price = Math.floor((Math.random() * 100) + 1);
      let buy_price = Math.floor((Math.random() * 100) + 1);
      enum OrderType {"Market" = 1,"Limit","Stop"};
      let sell_RandomOrderType = Math.floor((Math.random() * 3) + 1);
      let buy_RandomOrderType = Math.floor((Math.random() * 3) + 1);
      let sell_qty = Math.floor((Math.random() * 20) + 1);
      let buy_qty = Math.floor((Math.random() * 20) + 1);
      let misc = false;
      let sell_data = OrderType[sell_RandomOrderType] == "Market" ? abiCoder.encode([],[]) : abiCoder.encode(["string", "uint"], [OrderType[sell_RandomOrderType], fp(sell_price)]);
      let buy_data = OrderType[buy_RandomOrderType] == "Market" ? abiCoder.encode([],[]) : abiCoder.encode(["string", "uint"], [OrderType[sell_RandomOrderType], fp(buy_price)])
      let securityTraded: BigNumber,currencyTraded: BigNumber;

      it(`Sell QTY: ${sell_qty}@Price: ${sell_price} Order: ${OrderType[sell_RandomOrderType]} >>> Buy QTY: ${buy_qty}@Price: ${buy_price} Order: ${OrderType[buy_RandomOrderType]}`, async() => {
        if(OrderType[buy_RandomOrderType] == "Market") //Case: Buy at Market Price
        {
          if(sell_qty >= buy_qty)
          {
            securityTraded = fp(buy_qty);
            currencyTraded = mulDown(securityTraded,fp(sell_price));
          }
          else if(sell_qty < buy_qty)
          { 
            misc = true;
            securityTraded = fp(sell_qty);
            currencyTraded = mulDown(securityTraded,fp(sell_price));
          }
        }
        else if (OrderType[sell_RandomOrderType] == "Market"){ //Case: Sell at Market Price
          if(sell_qty >= buy_qty)
          {
            securityTraded = fp(buy_qty);
            currencyTraded = mulDown(securityTraded,fp(buy_price));
          }
          else if(sell_qty < buy_qty)
          {
            securityTraded = fp(sell_qty);
            currencyTraded = mulDown(securityTraded,fp(buy_price));
          }
        }
        else { 
          if(sell_qty >= buy_qty)
          {
            securityTraded = fp(buy_qty);
            currencyTraded = mulDown(securityTraded,fp(sell_price)); 
          }
          else if(sell_qty < buy_qty)
          {
            securityTraded = fp(sell_qty);
            currencyTraded = mulDown(securityTraded,fp(sell_price));
          }
        }

        if(OrderType[sell_RandomOrderType] == "Market")
        {
          await expect(pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: fp(sell_qty),
            from: lp,
            balances: currentBalances, 
            data: sell_data, 
          })).to.be.revertedWith("Insufficient liquidity");
          return;
        }
        else{
          await pool.swapGivenIn({
            in: pool.securityIndex,
            out: pool.currencyIndex,
            amount: fp(sell_qty),
            from: lp,
            balances: currentBalances, 
            data: sell_data, 
          });
        }
        
        if(misc && OrderType[buy_RandomOrderType] == "Market")
        {
          await expect(pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: fp(buy_qty),
            from: trader,
            balances: currentBalances,
            data: buy_data, 
             
          })).to.be.revertedWith("Insufficient liquidity");
        }
        else {
          const buy_order = await pool.swapGivenOut({
            in: pool.currencyIndex,
            out: pool.securityIndex,
            amount: fp(buy_qty),
            from: trader,
            balances: currentBalances,
            data: buy_data, 
             
          });

          if(OrderType[buy_RandomOrderType] == "Market")
          {
            expect(buy_order[0].toString()).to.be.equals(currencyTraded.toString()); 
            const counterPartyTrades = await ob.getTrades({from: lp});
            const partyTrades = await ob.getTrades({from: trader});

            const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
            const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
        
            await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy","Market");
          }
          else{
            if (buy_order[1]) {
                const counterPartyTrades = await ob.getTrades({from: lp});
                const partyTrades = await ob.getTrades({from: trader});

                const cpTradesInfo = await ob.getTrade({from: lp, tradeId: Number(counterPartyTrades[0]) });
                const pTradesInfo = await ob.getTrade({from: trader, tradeId: Number(partyTrades[0]) });
            
                await callSwapEvent(cpTradesInfo,pTradesInfo,securityTraded,currencyTraded,"Sell","Buy");
            }
          }
          
        }
      })
    });
    

  });

  context('Part fills of Order', () => {
    let buy_qty: BigNumber;
    let avgCurrencyTraded: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      buy_qty = fp(10); //qty
      avgCurrencyTraded = mulDown(fp(1), fp(100))
      .add(mulDown(fp(2), fp(101))
      .add(mulDown(fp(3), fp(102))
      .add(mulDown(fp(4), fp(103)))));
    });

    it('Sell 4 orders & 1 Buy Market Order', async () => {
      await pool.swapGivenIn({ // Sell Security 1@100
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(1),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(100)]),
      });
      await pool.swapGivenIn({ // Sell Security 2@101
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(2),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(101)]),
         
      });
      await pool.swapGivenIn({ // Sell Security 3@102
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(3),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(102)]),
         
      });
      await pool.swapGivenIn({ // Sell Security 4@103
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(4),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(103)]),
         
      });
      await pool.swapGivenIn({ // Sell Security 5@104
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(5),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Stop', fp(104)]),
         
      });
      const buy_order = await pool.swapGivenOut({ // Buy Security 10@CMP
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: fp(10),
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode([], []),
         
      });
      expect(buy_order[0].toString()).to.be.equals(avgCurrencyTraded.toString()); 
    });
    it('Sell 3 orders & 1 Buy Market Order [Insufficient Liquidity]', async () => {
      
      await pool.swapGivenIn({ // Sell Security 1@100
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(1),
        from: trader,
        balances: currentBalances, 
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(100)]),
      });
      await pool.swapGivenIn({ // Sell Security 2@101
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(2),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(101)]),
         
      });
      await pool.swapGivenIn({ // Sell Security 3@102
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(3),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(102)]),
         
      });
      await expect(pool.swapGivenOut({ // Buy Security 10@CMP
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: fp(10),
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode([], []),
         
      })).to.be.revertedWith("Insufficient liquidity");
      
    });
    it('Sell 4 Buy orders & 1 Sell Market Order', async () => {
      
      await pool.swapGivenOut({ 
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: fp(1),
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(100)]),
         
      });
      await pool.swapGivenOut({ 
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: fp(2),
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(101)]),
         
      });
      await pool.swapGivenOut({ 
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: fp(3),
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(102)]),
         
      });
      await pool.swapGivenOut({ 
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: fp(4),
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(103)]),
         
      });
      await pool.swapGivenOut({ 
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: fp(5),
        from: lp,
        balances: currentBalances,
        data: abiCoder.encode(["string", "uint"], ['Limit', fp(104)]),
         
      });
      const sell_order = await pool.swapGivenIn({ 
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: fp(10),
        from: trader,
        balances: currentBalances,
        data: abiCoder.encode([], []), 
         
      });

      expect(sell_order[0].toString()).to.be.equal(avgCurrencyTraded.toString());
      
    });
  })

});

  describe('joins and exits', () => {
    let maxAmountsIn : BigNumber[];
    sharedBeforeEach('deploy pool', async () => {
      await deployPool({ securityToken, currencyToken }, false);
      await tokens.approve({ from: owner, to: pool.vault.address, amount: fp(500) });

        maxAmountsIn = new Array(tokens.length);
        maxAmountsIn[pool.securityIndex] = maxSecurityOffered; 
        maxAmountsIn[pool.currencyIndex] = maxCurrencyOffered;
        maxAmountsIn[pool.bptIndex] = fp(0);

        await pool.init({ from: owner, recipient: owner.address, initialBalances: maxAmountsIn });
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
    
    context('when paused for emergency proportional exit', () => {
      it('gives back tokens', async () => {
          const previousBalances = await pool.getBalances();
          const prevSecurityBalance = await securityToken.balanceOf(owner);
          const prevCurrencyBalance = await currencyToken.balanceOf(owner);

          const bptAmountIn = MAX_UINT112.sub(_DEFAULT_MINIMUM_BPT);
          await pool.exitGivenOut({
            from: owner, 
            recipient: owner.address, 
            amountsOut: previousBalances, 
            bptAmountIn: bptAmountIn
          });
     
          const afterExitOwnerBalance = await pool.balanceOf(owner);
          const currentBalances = await pool.getBalances();
          const afterExitSecurityBalance = await securityToken.balanceOf(owner);
          const afterExitCurrencyBalance = await securityToken.balanceOf(owner);

          expect(currentBalances[pool.bptIndex]).to.be.equal(0);
          expect(currentBalances[pool.securityIndex]).to.be.equal(0);
          expect(currentBalances[pool.currencyIndex]).to.be.equal(0);

          expect(afterExitSecurityBalance).to.be.equal(prevSecurityBalance.add(previousBalances[pool.securityIndex]));
          expect(afterExitCurrencyBalance).to.be.equal(prevCurrencyBalance.add(previousBalances[pool.currencyIndex]));

          expect(afterExitOwnerBalance).to.be.equal(0);
        }); 
    });

  });
});