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

  const eventName = "CallSwap(bool,string,address,bool,string,address,uint256)";
  const eventType = ["bool swapKindParty", "string tokenInParty", "address party", "bool swapKindCounterparty", "string tokenInCounterparty", "address counterParty", "uint256 swapId"];
  const encodedEventSignature = keccak256(toUtf8Bytes(eventName));

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

    sharedBeforeEach('deploy and initialize pool', async () => {

      secondary_pool = await deployPool({ securityToken, currencyToken }, true);

      await setBalances(pool, { securityBalance: fp(500), currencyBalance: fp(500), bptBalance: fp(0) });
      
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
   
  const callSwapEvent = async(eventLogData: Bytes, securityTraded: BigNumber, currencyTraded: BigNumber, counterPartyOrder: string, partyOrder: string) => {
    const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,eventLogData);
    const counterPartyTx = {
      in: eventEncodedData.tokenInCounterparty == "security" ? pool.securityIndex :  pool.currencyIndex,
      out:  eventEncodedData.tokenInCounterparty != "security" ? pool.securityIndex :  pool.currencyIndex,
      amount: eventEncodedData.swapId,
      from: eventEncodedData.counterParty == lp.address ? lp : trader,
      balances: currentBalances,
      data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('0'+eventEncodedData.swapId.toString())), 
    };
    const partyDataTx = {
      in: eventEncodedData.tokenInParty == "security" ? pool.securityIndex :  pool.currencyIndex,
      out:  eventEncodedData.tokenInParty != "security" ? pool.securityIndex :  pool.currencyIndex,
      amount: eventEncodedData.swapId,
      from: eventEncodedData.party == lp.address ? lp : trader,
      balances: currentBalances,
      data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('0'+eventEncodedData.swapId.toString())),
    };

    const counterPartyAmount = eventEncodedData.swapKindCounterparty ?  await pool.swapGivenIn(counterPartyTx) :  await pool.swapGivenOut(counterPartyTx);
    const counterTradedAmount = counterPartyOrder == "Sell" ? securityTraded.toString() : currencyTraded.toString();
    const orderName = counterPartyOrder == "Sell" ? "Security Traded" : "Currency Traded";
    // console.log(orderName,counterTradedAmount);
    
    const partyAmount = eventEncodedData.swapKindParty ?  await pool.swapGivenIn(partyDataTx) :  await pool.swapGivenOut(partyDataTx);
    const partyTradedAmount = partyOrder == "Sell" ? securityTraded.toString() : currencyTraded.toString();
    const orderName2 = partyOrder == "Sell" ? "Security Traded" : "Currency Traded";
    // console.log(orderName2,partyTradedAmount);
    expect(counterPartyAmount[0].toString()).to.be.equals(counterTradedAmount); 
    expect(partyAmount[0].toString()).to.be.equals(partyTradedAmount); 
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
      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Sell 20@Market Price,
        eventHash: encodedEventSignature
      });
      
      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy 500@market price
        eventHash: encodedEventSignature
      });

      expect(buy_order[0].toNumber()).to.be.equals(0); 
      expect(sell_order[0].toNumber()).to.be.equals(0); 
    });

    it('Market order: Sell Order@CMP > Buy Limit Order', async () => {
      const currencyTraded = mulDown(sell_qty,buy_price);
      const securityTraded = divDown(currencyTraded, buy_price);
      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Sell 10@Market Price
        eventHash: encodedEventSignature
      });
      console.log("After Sell");
      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // LimitOrder Buy 15@210
        eventHash: encodedEventSignature
      });
      console.log("After BUY");
      if (buy_order[1]) {
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Market order: Sell Order@CMP > Buy Stop Order', async () => {
      const currencyTraded = mulDown(sell_qty,buy_price);
      const securityTraded = divDown(currencyTraded, buy_price);
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
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
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
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
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
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy@market price
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell SWAP Out Currency Order > Buy SWAP OUT Security Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(20);
      const securityTraded = divDown(sell_qty,sell_price);
      const currencyTraded = mulDown(securityTraded,sell_price);

      const sell_order = await pool.swapGivenOut({
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
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell SWAP In Security Order > Buy SWAP OUT Security Order', async () => {
      sell_qty = fp(10);
      buy_qty = fp(5);
      const securityTraded = buy_qty;
      const currencyTraded = mulDown(securityTraded,sell_price);

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
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
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
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
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
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
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
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // MarketOrder Buy@market price
        eventHash: encodedEventSignature
      });

      if (sell_order[1]) {
        await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Buy[Limit] SWAP Out Security Order > Sell [Market] SWAP IN Security Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(10);
      const securityTraded = buy_qty;
      const currencyTraded = mulDown(buy_qty,buy_price);

      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // Limit Order Buy@price 20
        eventHash: encodedEventSignature
      });

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), 
        eventHash: encodedEventSignature
      });

      if (sell_order[1]) {
        await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
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
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // Limit Order Buy@price 20
        eventHash: encodedEventSignature
      });

      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())), // Limit Sell@price 10
        eventHash: encodedEventSignature
      });

      if (sell_order[1]) {
        await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
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
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // Limit Order Buy@price 20
          eventHash: encodedEventSignature
      });
  
      const sell_order = await pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: sell_qty,
          from: trader,
          balances: currentBalances,
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())), // Limit Sell@price 10
          eventHash: encodedEventSignature
      });
  
      if (sell_order[1]) {
          await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
          console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });
  
    it('Buy SWAP Out Security Order > Sell SWAP Out Security Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(5);
      const currencyTraded = mulDown(buy_qty, buy_price);
      const securityTraded = divDown(currencyTraded,buy_price);
  
      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // Limit Order Buy@price 20
        eventHash: encodedEventSignature
      });
  
      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())), // Limit Sell@price 10
        eventHash: encodedEventSignature
      });
  
      if (sell_order[1]) {
        await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Buy SWAP In Currency Order > Sell SWAP Out Currency Order', async () => {
      sell_qty = fp(50);
      buy_qty = fp(100);
      const currencyTraded = sell_qty;
      const securityTraded = divDown(currencyTraded,buy_price);
  
      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + buy_price.toString())), // Stop Order Buy@price 20
        eventHash: encodedEventSignature
      });

      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + sell_price.toString())), // Stop Sell@price 10
        eventHash: encodedEventSignature
      });
  
      if (sell_order[1]) {
        await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });
  
    it('Buy SWAP Out Security Order > Sell SWAP Out Currency Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(100);
      const currencyTraded = sell_qty;
      const securityTraded = divDown(currencyTraded,buy_price);
      const buy_order = await pool.swapGivenOut({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: lp,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + buy_price.toString())), // Limit Order Buy@price 20
        eventHash: encodedEventSignature
      });
  
      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // Limit Sell@price 10
        eventHash: encodedEventSignature
      });
  
      if (sell_order[1]) {
        await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
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
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop' + buy_price.toString())), // Limit Order Buy@price 20
        eventHash: encodedEventSignature
      });
  
      const sell_order = await pool.swapGivenOut({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // Limit Sell@price 10
        eventHash: encodedEventSignature
      });
  
      if (sell_order[1]) {
        await callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
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
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('4Stop'+ sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
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
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + sell_price.toString())), // Limit Order Sell@price12
        eventHash: encodedEventSignature
      });
      
      const ob = await pool.orderbook();
      const _ref = await ob.getOrderRef({from: lp});

      const edit_order = await ob.editOrder({
        ref: _ref[0].toString(),
        price: sell_qty, //Changed price from 20[selling price] --> 20[buying price]
        amount: sell_price, //Changed Qty from 10[sell amount] --> 20[buy amount]
        from: lp
      });

      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        from: trader,
        balances: currentBalances,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy@market price
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });
  });

  context('Random OrderBook Testing', () => {
    [...Array(10).keys()].forEach(value => {
      let sell_price = Math.floor((Math.random() * 100) + 1);
      let buy_price = Math.floor((Math.random() * 100) + 1);
      enum OrderType {"Market" = 1,"5Limit","4Stop"};
      let sell_RandomOrderType = Math.floor((Math.random() * 3) + 1);
      let buy_RandomOrderType = Math.floor((Math.random() * 3) + 1);
      let sell_qty = Math.floor((Math.random() * 20) + 1);
      let buy_qty = Math.floor((Math.random() * 20) + 1);

      let sell_data = OrderType[sell_RandomOrderType] == "Market" ? "" : OrderType[sell_RandomOrderType].toString() + fp(sell_price).toString();
      let buy_data = OrderType[buy_RandomOrderType] == "Market" ? "" : OrderType[buy_RandomOrderType].toString() + fp(buy_price).toString();
      let securityTraded: BigNumber,currencyTraded: BigNumber;

      it(`Sell QTY: ${sell_qty}@Price: ${sell_price} Order: ${OrderType[sell_RandomOrderType]} >>> Buy QTY: ${buy_qty}@Price: ${buy_price} Order: ${OrderType[buy_RandomOrderType]}`, async() => {
        if(buy_data.length == 0) //Case: Buy at Market Price
        {
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
        else if (sell_data.length == 0){ //Case: Sell at Market Price
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

        const sell_order = await pool.swapGivenIn({
          in: pool.securityIndex,
          out: pool.currencyIndex,
          amount: fp(sell_qty),
          from: lp,
          balances: currentBalances, 
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(sell_data)), 
        });
  
        const buy_order = await pool.swapGivenOut({
          in: pool.currencyIndex,
          out: pool.securityIndex,
          amount: fp(buy_qty),
          from: trader,
          balances: currentBalances,
          data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(buy_data)), 
          eventHash: encodedEventSignature
        });
  
        if (buy_order[1]) {
          await callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
        }

      })
    });
    

  });
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
