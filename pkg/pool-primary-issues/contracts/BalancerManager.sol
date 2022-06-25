// Balancer asset manager
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import '@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol';
import '@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol';
import '@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol';
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import '@balancer-labs/v2-vault/contracts/interfaces/IVault.sol';
import '@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol';

import './interfaces/IPrimaryIssuePoolFactory.sol';
import './interfaces/IPrimaryIssuePool.sol';
import './interfaces/IMarketMaker.sol';

contract BalancerManager is IMarketMaker, Ownable{

    using Math for uint256;

    // balancer variables
    IPrimaryIssuePoolFactory public factory;
    IVault vault;
    uint256 issueFeePercentage=0;

    // modifiers
    modifier onlyPool(bytes32 poolId, address security) {
        require(poolId == IPrimaryIssuePool(security).getPoolId());
        _;
    }   

    // list of offered tokens
    address[] internal offeredTokens;

    // mapping token offered (eg, security token or its corresponding settlement token) to its position in the list of offered tokens
    mapping(address => uint256) private offeredTokenIndex;

    // list of tokens (eg, security token or its corresponding settlement token) to match
    mapping(address => token[]) internal toMatchTokens;

    // mapping offered token (eg, security token) to a token to match (eg, settlement token)
    mapping(address => mapping(address => token[])) internal mmtokens;

    // mapping offered token (ie security token) to its paired token (ie, settlement tokens which is matched by the issuing function)
    mapping(address => address[]) internal pairedTokens;

    // mapping settlement token to its position in the list of settlement tokens
    mapping(address => mapping(address => uint256)) private pairedTokenIndex;

    // data structure that holds settlement price curve data offered by market makers
    struct liquidity{
        uint minPrice;
        uint maxPrice;
        uint amountIssued;
        uint amountOffered;
    }

    // mapping security token to its price and amount offered by market makers (LPs)
    mapping(address => mapping(address => liquidity)) internal qlTokens;

    // mapping security to liquidity providers (LPs)
    mapping(address => lp[]) private liquidityProviders;

    // mapping security tokens issued in the primary issue pool to total liquidity (ie, amount of settlement tokens) offered
    mapping(address => uint256) private totalUnderwritten;

    // components of a primary issue of a security token
    struct primary{
        uint256 deadline;
        uint256 startTime;
        bytes32[] pools;
        address issuer;
    }

    // mapping security to new issues in the primary issue pool
    mapping(address => primary) internal issues;

    // mapping primary issue pool id to subscribers that swap in assets into pool
    mapping(bytes32 => subscriptions[]) internal investors; 

    // mapping primary issue pool id to subscriber and its position in the list of subscribers to the pool
    mapping(bytes32 => mapping(address => uint256)) private subscriberIndex;

    // mapping pool id to asset to subscription amounts
    mapping(bytes32 => mapping(address => uint256)) private subscribed;

    // mapping pool id to pool address
    mapping(bytes32 => address) private pools;

    // mapping pool id to security token offered
    mapping(bytes32 => address) private poolSecurity;

    /**
        Initializes this asset management contract
        @param  _factory            reference to the primary issue pool factory contract
        @param  _issueFeePercentage  percentage of trading fee to be charged by the asset manager
        @param  _vault              reference to the Balancer vault
     */
    function initialize(address _factory, uint256 _issueFeePercentage, address _vault) onlyOwner public {
        factory = IPrimaryIssuePoolFactory(_factory);
        vault = IVault(_vault);
        issueFeePercentage = _issueFeePercentage;
    }

    /**
        Called by market maker and issuer for adding liquidity
        @param  owned       is the security or settlement token on offer 
        @param  offered     is the amount offered
        @param  tomatch     is the liquidity token that is required to be paired
        @param  desired     is the amount required of the liquidity token to be paired
        @param  min         is the minimum amount to be swapped of the 'offered' token 
        @param  isin        is the identifier for the security token offered
     */ 
    function offer(address owned, bytes32 isin, uint offered, address tomatch, uint desired, uint min) override external{
        if(IERC20(owned).balanceOf(msg.sender)>=offered){ 
            IERC20(owned).transferFrom(msg.sender, address(this), offered);
            make(msg.sender, owned, isin, offered, tomatch, desired, min); 
        }
    }

    function make(address _owner, address owned, bytes32 _isin, uint _offered, address tomatch, uint _desired, uint _min) private {
        IMarketMaker.token memory t = IMarketMaker.token({
            owner: _owner,
            offered: owned,
            amountDesired: _desired,
            amountOffered: _offered,
            min: _min,
            isin: _isin
        });
        uint256 index = mmtokens[owned][tomatch].length;
        mmtokens[owned][tomatch].push(t);
        if(offeredTokenIndex[owned]==0){
            offeredTokens.push(owned);
            offeredTokenIndex[owned] = offeredTokens.length;
        }
        toMatchTokens[tomatch].push(mmtokens[owned][tomatch][index]);        
    }

    /**
        Gets tokens to match for offered token
        @param  offered address of offered token
     */
    function getOffered(address offered) override external view returns(IMarketMaker.token[] memory){
        return toMatchTokens[offered];
    }

    /**
        Gets offer made previously
        @param  _owned      address of token offered
        @param  _tomatch    address of token to match
     */
    function getOfferMade(address _owned, address _tomatch) override external view returns(IMarketMaker.token[] memory){
        return mmtokens[_owned][_tomatch];
    }

    /**
        Fetches liquidity providers for a security token
        @param  _security   identifier for the security token offered
     */
    function getLiquidityProviders(address _security) override external view returns(lp[] memory){
        return liquidityProviders[_security];
    }

    /**
        Called by issuer of 'security' token to open an issue which will last till 'cutoffTime'
        @param  security    security offered to the primary issue pool
        @param  cutoffTime  time in milliseconds by when offer closes
     */
    function issue(address security, uint256 cutoffTime) override external {
        // check if security to be issued has been offered by the issuer, and if yes, initialize the issuance
        uint i = offeredTokenIndex[security];
        if(offeredTokens[i]==security){
            
            // check all offered securities that is not the security to be issued
            for(uint j=0; j<offeredTokens.length; j++){
                if(offeredTokens[j]!=security){

                    // check if the request to issue has come from the issuer
                    if(mmtokens[offeredTokens[i]][offeredTokens[j]][0].owner == msg.sender){

                        for(uint k=0; k<mmtokens[offeredTokens[j]][offeredTokens[i]].length; k++){

                            // find tokens offered against security to be issued
                            if(mmtokens[offeredTokens[i]][offeredTokens[j]][0].amountOffered!=0){
                                if(mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountOffered!=0){
                                    
                                    // if min offer price for security issued is greater than price desired by market maker (LP)
                                    if( Math.divDown(mmtokens[offeredTokens[i]][offeredTokens[j]][0].min,
                                        mmtokens[offeredTokens[i]][offeredTokens[j]][0].amountOffered) >=
                                        Math.divDown(mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountOffered,
                                        mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountDesired))
                                    {   
                                        // store settlement tokens    
                                        if(pairedTokenIndex[security][offeredTokens[j]]==0){
                                            pairedTokens[security].push(offeredTokens[j]);
                                            pairedTokenIndex[security][offeredTokens[j]] = pairedTokens[security].length;
                                        }

                                        // find and store min price for token offered
                                        if(Math.divDown(mmtokens[offeredTokens[i]][offeredTokens[j]][0].min,
                                            mmtokens[offeredTokens[i]][offeredTokens[j]][0].amountOffered) < 
                                            qlTokens[security][offeredTokens[j]].minPrice  || 
                                            qlTokens[security][offeredTokens[j]].minPrice==0)
                                        {
                                            qlTokens[security][offeredTokens[j]].minPrice = 
                                                        Math.divDown(mmtokens[offeredTokens[i]][offeredTokens[j]][0].min,
                                                        mmtokens[offeredTokens[i]][offeredTokens[j]][0].amountOffered);
                                        }
                                        // find and store max price for token offered
                                        if(Math.divDown(mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountOffered,
                                            mmtokens[offeredTokens[j]][offeredTokens[i]][k].min) > 
                                            qlTokens[security][offeredTokens[j]].maxPrice)
                                        {
                                            qlTokens[security][offeredTokens[j]].maxPrice = 
                                                        Math.divDown(mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountOffered,
                                                        mmtokens[offeredTokens[j]][offeredTokens[i]][k].min);                                        
                                        }  
                                        qlTokens[security][offeredTokens[j]].amountIssued = 
                                                        Math.add(qlTokens[security][offeredTokens[j]].amountIssued,
                                                        mmtokens[offeredTokens[i]][offeredTokens[j]][0].amountOffered);
                                        qlTokens[security][offeredTokens[j]].amountOffered = 
                                                        Math.add(qlTokens[security][offeredTokens[j]].amountOffered,
                                                        mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountOffered);  
                                        // store qualified liquidity provider info
                                        lp memory provider = lp({
                                            owner : mmtokens[offeredTokens[j]][offeredTokens[i]][k].owner,
                                            tokenOffered : offeredTokens[j],
                                            underwritten : mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountOffered,
                                            subscribed : 0,
                                            earned : 0
                                        });
                                        liquidityProviders[offeredTokens[i]].push(provider);  

                                        totalUnderwritten[offeredTokens[i]] = 
                                        SafeMath.add(totalUnderwritten[offeredTokens[i]], mmtokens[offeredTokens[j]][offeredTokens[i]][k].amountOffered);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            //create primary issue pool if it does not exist already
            for(uint x=0; x<pairedTokens[security].length; x++){
                address lptoken = pairedTokens[security][x];
                address newIssue = factory.create(security, lptoken, 
                                                    qlTokens[security][lptoken].minPrice,
                                                    qlTokens[security][lptoken].maxPrice,
                                                    qlTokens[security][lptoken].amountIssued,
                                                    issueFeePercentage,
                                                    cutoffTime);                  
                // store details of new pool created
                issues[security].issuer = mmtokens[security][lptoken][0].owner;
                issues[security].deadline = cutoffTime;
                issues[security].startTime = block.timestamp;
                bytes32 pool = IPrimaryIssuePool(newIssue).getPoolId();
                issues[security].pools[issues[security].pools.length] = pool;
                pools[pool] = newIssue;
                poolSecurity[pool] = security;
                // initialize the pool here
                vault.setRelayerApproval(address(this), newIssue, true);
                IPrimaryIssuePool(newIssue).initialize();
                // take right to manage pool
                IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
                ops[0] = IVault.PoolBalanceOp({
                    kind: IVault.PoolBalanceOpKind.WITHDRAW,
                    poolId: pool,
                    token: IERC20(lptoken),
                    amount: qlTokens[security][lptoken].amountIssued
                });
                vault.managePoolBalance(ops);
                delete qlTokens[security][lptoken];
            }
            delete pairedTokens[security];
        }
    }

    // called by pool when assets are swapped in by investors against security tokens issued
    function subscribe(bytes32 poolId, address security, address assetIn, bytes32 assetName, uint256 amount, address investor, uint256 price) override onlyPool(poolId, security) external {
        investors[poolId].push(IMarketMaker.subscriptions(investor, assetIn, assetName, amount, price));
        subscriberIndex[poolId][investor] = investors[poolId].length;
        subscribed[poolId][assetIn] = Math.add(subscribed[poolId][assetIn], amount);
    }

    /**
        Fetches investors (subscribers) to a primary issue pool
        @param   poolId identifier for a primary issue pool for which subscribers are to be returned
     */
    function getSubscribers(bytes32 poolId) override external view returns(subscriptions[] memory){
        return investors[poolId];
    }

    /**
        Called by issuer to close subscription of 'security' issued by it
        @param  security    address of security token
     */  
    function close(address security) override external view returns(bytes32[] memory, bool) {
        if(block.timestamp > issues[security].deadline)
            return (issues[security].pools, true);
        else
            return (issues[security].pools, false);
    }

    /**
        Called by issuer to accept subscription to issue by investor
        @param  poolid      identifier of primary issue pool in which subscription is made by investor
        @param  investor    address of investor (subscriber)
        @param  amnt        amount of investment (subscription capital) accepted by issuer for which allotment of security tokens are made to investor
        @param  asset       address of asset which is used by investor to subscribe to the issue
     */ 
    function accept(bytes32 poolid, address investor, uint256 amnt, address asset) override external {
        uint256 invested = 0;
        uint256 i = subscriberIndex[poolid][investor];
        if(i>0)
            invested = Math.add(invested, investors[poolid][i-1].amount);
        // transfer subscriptions for allotments to asset manager for asset subscribed with
        address issued = IPrimaryIssuePool(pools[poolid]).getSecurity();
        // refund balance to investors
        IERC20(asset).transfer(investor, Math.sub(invested, amnt));
        for(i=0; i<liquidityProviders[issued].length; i++){
            if(liquidityProviders[issued][i].tokenOffered==asset && amnt!=0){
                uint256 proportionUnderwritten = liquidityProviders[issued][i].underwritten / totalUnderwritten[issued];
                uint256 prorataAmount = Math.mul(proportionUnderwritten, subscribed[poolid][asset]);
                // transfer allotted amount to asset manager
                if(prorataAmount > amnt){
                    IERC20(asset).transfer(liquidityProviders[issued][i].owner, amnt);
                    SafeMath.add(liquidityProviders[issued][i].subscribed, amnt);
                    amnt = 0;
                }
                else{
                    IERC20(asset).transfer(liquidityProviders[issued][i].owner, prorataAmount);
                    SafeMath.add(liquidityProviders[issued][i].subscribed, prorataAmount);
                    amnt = Math.sub(amnt, prorataAmount);
                }
            }
        }
    }

    /**
        Called by issuer to reject subscription to issue by investor
        @param  poolid      identifier for primary issue pool to which investor has subscribed
        @param  investor    address of investor (subscriber)
     */ 
    function reject(bytes32 poolid, address investor) override external {
        uint256 i = subscriberIndex[poolid][investor];
        if(i>0){
            IERC20(investors[poolid][i-1].asset).transfer(investor, investors[poolid][i-1].amount);
        }
    }

    /**
        Called by product issuer to settle distribution of fee income arising from investment underwritten in the primary issue pool
        @param  poolId  identifier for primary issue pool
     */  
    function settle(bytes32 poolId) override external {
        IPrimaryIssuePool(pools[poolId]).exit(); 
        delete investors[poolId];     
    }
   
}