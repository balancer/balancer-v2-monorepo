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
  
  const TOTAL_TOKENS = 3;
  const SCALING_FACTOR = fp(1);
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
    await tokens.mint({ to: [lp, trader], amount: fp(500) });

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
   
  const callSwapEvent = async(eventLogData: Bytes, securityTraded: BigNumber, currencyTraded: BigNumber, counterPartyOrder: string, partyOrder: string) => {
    const eventEncodedData =  ethers.utils.defaultAbiCoder.decode(eventType,eventLogData);
    const counterPartyTx = {
      in: eventEncodedData.tokenInCounterparty == "security" ? pool.securityIndex :  pool.currencyIndex,
      out:  eventEncodedData.tokenInCounterparty == "security" ? pool.securityIndex :  pool.currencyIndex,
      amount: 0,
      from: eventEncodedData.counterParty == lp.address ? lp : trader,
      balances: currentBalances,
      data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(eventEncodedData.swapId.toString())), 
    };
    const partyDataTx = {
      in: eventEncodedData.tokenInParty == "security" ? pool.securityIndex :  pool.currencyIndex,
      out:  eventEncodedData.tokenInParty == "security" ? pool.securityIndex :  pool.currencyIndex,
      amount: 0,
      from: eventEncodedData.party == lp.address ? lp : trader,
      balances: currentBalances,
      data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(eventEncodedData.swapId.toString())),
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
    let beforeSwapLPCurrency: BigNumber;
    let beforeSwapLPSecurity: BigNumber;
    let beforeSwapTraderCurrency: BigNumber;
    let beforeSwapTraderSecurity: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(20); // sell qty
      buy_qty = fp(500); // buy qty
      buy_price = fp(40); // Buying price
      beforeSwapLPCurrency = await currencyToken.balanceOf(lp);
      beforeSwapLPSecurity = await securityToken.balanceOf(lp);
      beforeSwapTraderCurrency = await currencyToken.balanceOf(trader);
      beforeSwapTraderSecurity = await securityToken.balanceOf(trader);
    });
    
    it('accepts Empty order: Sell Order@CMP > Buy Order@CMP', async () => {
      const currencyTraded = mulDown(sell_qty,buy_price);
      const securityTraded = divDown(currencyTraded, buy_price);
      const sell_order = await pool.swapGivenIn({
        in: pool.securityIndex,
        out: pool.currencyIndex,
        amount: sell_qty,
        balances: currentBalances,
        from: lp,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Sell 15@Market Price,
        eventHash: encodedEventSignature
      });
      
      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('')), // MarketOrder Buy 15@market price
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

      const buy_order = await pool.swapGivenIn({
        in: pool.currencyIndex,
        out: pool.securityIndex,
        amount: buy_qty,
        balances: currentBalances,
        from: trader,
        data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('5Limit' + buy_price.toString())), // LimitOrder Buy 15@210
        eventHash: encodedEventSignature
      });

      if (buy_order[1]) {
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
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
    let beforeSwapLPCurrency: BigNumber;
    let beforeSwapLPSecurity: BigNumber;
    let beforeSwapTraderCurrency: BigNumber;
    let beforeSwapTraderSecurity: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(20); //qty
      buy_qty = fp(500); //qty
      sell_price = fp(20); // Selling price
      beforeSwapLPCurrency = await currencyToken.balanceOf(lp);
      beforeSwapLPSecurity = await securityToken.balanceOf(lp);
      beforeSwapTraderCurrency = await currencyToken.balanceOf(trader);
      beforeSwapTraderSecurity = await securityToken.balanceOf(trader);
    });

    it('Sell SWAP IN Security Order > Buy SWAP IN Currecny Order', async () => {
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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell SWAP Out Currency Order > Buy SWAP IN Currecny Order', async () => {
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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell SWAP In Security Order > Buy SWAP IN Currecny Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(100);
      const currencyTraded = mulDown(sell_qty,sell_price);
      const securityTraded = divDown(buy_qty, sell_price);

      const sell_order = await pool.swapGivenIn({
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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell SWAP Out Currency Order > Buy SWAP IN Currecny Order', async () => {
      buy_qty = fp(100);
      sell_qty = fp(400);
      const currencyTraded = sell_qty;
      const securityTraded = divDown(buy_qty,sell_price);

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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell SWAP In Security Order > Buy SWAP OUT Security Order', async () => {
      sell_qty = fp(10);
      buy_qty = fp(20);
      const securityTraded = sell_qty;
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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell SWAP Out Currency Order > Buy SWAP OUT Security Order', async () => {
      sell_qty = fp(400);
      buy_qty = fp(10);
      const securityTraded = divDown(sell_qty,sell_price);
      const currencyTraded = mulDown(buy_qty,sell_price);

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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Sell[Limit] SWAP In Security Order > Buy [Market] SWAP OUT Security Order', async () => {
      sell_qty = fp(40);
      buy_qty = fp(10);
      const securityTraded = sell_qty;
      const currencyTraded = mulDown(buy_qty,sell_price);

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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
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
    let beforeSwapLPCurrency: BigNumber;
    let beforeSwapLPSecurity: BigNumber;
    let beforeSwapTraderCurrency: BigNumber;
    let beforeSwapTraderSecurity: BigNumber;

    sharedBeforeEach('initialize values ', async () => {
      sell_qty = fp(20); //qty
      buy_qty = fp(300); //qty
      buy_price = fp(20); // Buy price
      sell_price = fp(10);
      beforeSwapLPCurrency = await currencyToken.balanceOf(lp);
      beforeSwapLPSecurity = await securityToken.balanceOf(lp);
      beforeSwapTraderCurrency = await currencyToken.balanceOf(trader);
      beforeSwapTraderSecurity = await securityToken.balanceOf(trader);
    });

    it('Buy [Limit] SWAP IN Currency Order > Sell [Limit] SWAP IN Security Order [Consecutive Limit Order]', async () => {
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
        callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
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
        callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Buy[Limit] SWAP IN Currency Order > Sell [Stop] SWAP IN Security Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(1000);
      const securityTraded = divDown(buy_qty, buy_price);
      const currencyTraded = mulDown(sell_qty, buy_price);

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
        callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Buy SWAP Out Security Order > Sell SWAP IN Security Order', async () => {
      sell_qty = fp(20);
      buy_qty = fp(50);
      const securityTraded = sell_qty;
      const currencyTraded = mulDown(sell_qty, buy_price);
  
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
          callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
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
        callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });

    it('Buy [Stop] SWAP In Currency Order > Sell [Stop] SWAP Out Security Order [Consecutive Sell Order]', async () => {
      sell_qty = fp(200);
      buy_qty = fp(100);
      const currencyTraded = buy_qty;
      const securityTraded = divDown(buy_qty,buy_price);
  
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
        callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });
  
    it('Buy [Stop] SWAP Out Security Order > Sell [Market] SWAP Out Security Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(100);
      const currencyTraded = mulDown(buy_qty, buy_price);
      const securityTraded = divDown(sell_qty,buy_price);
  
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
        callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
      }
      else{
        console.log("TEST CASE: Solidity Error, can't fire CallSwap Event");
      }
    });
  
    it('Buy [Stop] SWAP IN Currency Order > Sell[Limit] SWAP Out Security Order', async () => {
      sell_qty = fp(200);
      buy_qty = fp(500);
      const currencyTraded = buy_qty;
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
        callSwapEvent(sell_order[1],securityTraded,currencyTraded,"Buy","Sell");
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

      const _ref = await pool.getOrderRef({from: lp});

      const edit_order = await pool.editOrder({
        ref: _ref[0].toString(),
        price: editedPrice, //Changed price from 12[selling price] --> 18[buying price]
        amount: editedAmount, //Changed Qty from 10[sell amount] --> 12[buy amount]
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
        callSwapEvent(buy_order[1],securityTraded,currencyTraded,"Sell","Buy");
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
