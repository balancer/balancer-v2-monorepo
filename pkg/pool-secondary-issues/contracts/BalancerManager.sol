// External interface for settlement of trades
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

import "./interfaces/ISettlor.sol";
import "./interfaces/IOrder.sol";
import "./interfaces/ITrade.sol";
import "./interfaces/ISecondaryIssuePoolFactory.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
 
contract BalancerManager is ISettlor, Ownable {

    using Math for uint256;

    // mapping settlement ref to trade execution data
    mapping(bytes32 => ISettlor.settlement) settlements;

    // mapping pool id to issuer address to asset ref
    mapping(address => mapping(address => bytes32)) private issuers;

    //mapping depository participants to trades they are part of
    mapping(bytes32 => bytes32[]) private trades;

    event tradeSettled(address indexed transferor,
                        address indexed transferee,
                        uint256 unitsToTransfer,
                        address security,
                        uint256 price,
                        address currency
                    );

    /**
        Issues existing (secondary) tokenized assets into pool
        @param  factory     reference to the secondary issue pool factory contract
        @param  security    reference to asset issued
        @param  currency    reference to cash (settlement) token
        @param  amount      amount of asset issued in pool
        @param  fee         percentage of trading fee to be charged by the asset manager
        @param  id          identifier for asset issued
     */
    function issueSecondary(address factory, address security, address currency, uint256 amount, uint256 fee, bytes32 id) override external {
        address pool = ISecondaryIssuePoolFactory(factory).create(
            ERC20(security).name(),
            ERC20(security).symbol(),
            security,
            currency,
            amount,
            fee
        );
        issuers[pool][msg.sender] = id;
    }

    /**
        Posts trades matched in pool
        @param  newTrade    data structure with trade execution data
        @param  ref         reference to the asset traded
     */
    function postSettlement(ISettlor.settlement calldata newTrade, bytes32 ref) override external {
        trades[newTrade.transferorDPID].push(ref);
        trades[newTrade.transfereeDPID].push(ref);
        settlements[ref].transferor = newTrade.transferor;
        settlements[ref].transferee = newTrade.transferee;
        settlements[ref].security = newTrade.security;
        settlements[ref].consideration = newTrade.consideration;
        settlements[ref].price = newTrade.price;
        settlements[ref].currency = newTrade.currency;
        settlements[ref].unitsToTransfer = newTrade.unitsToTransfer;
        settlements[ref].executionDate = newTrade.executionDate;
        settlements[ref].status = newTrade.status;
        settlements[ref].orderPool = msg.sender;
        settlements[ref].partyRef = newTrade.partyRef;
        settlements[ref].counterpartyRef = newTrade.counterpartyRef;
    }

    /**
        Fetches trade settlement requests for depository participant
        @param  dpid         identifier of depository participant (eg, transfer agent) that is authorized to settle the asset 
     */
    function getSettlementRequests(bytes32 dpid) override external view returns(bytes32[] memory){
        return trades[dpid];
    }

    /**
        Fetches a specific trade settlement request        
        @param  ref         reference to the trade
     */
    function getSettlementRequest(bytes32 ref) override external view returns(settlement memory){
        require(ref!=""); 
        ISettlor.settlement memory response = ISettlor.settlement({
            transferor : settlements[ref].transferor,
            transferee : settlements[ref].transferee,
            security : settlements[ref].security,
            status : settlements[ref].status,
            transferorDPID : settlements[ref].transferorDPID,
            transfereeDPID : settlements[ref].transfereeDPID,
            currency : settlements[ref].currency,
            price : settlements[ref].price,
            consideration : settlements[ref].consideration,
            unitsToTransfer : settlements[ref].unitsToTransfer,
            executionDate : settlements[ref].executionDate,
            orderPool : settlements[ref].orderPool,
            partyRef : settlements[ref].partyRef,
            counterpartyRef : settlements[ref].counterpartyRef
        });
        return response;                                                              
    }
    
    /**
        Sets settlement status for trades executed
        @param  ref         reference to the trade executed
        @param  status      settlement status
        @param  id          identifier of asset traded
     */
    function setSettlementStatus(bytes32 ref, bytes32 status, bytes32 id) override external{
        require(status=="Confirm" || status=="Reject");
        settlements[ref].status = status;
        bool success;
        if(status=="Confirm"){
            uint256 pay = Math.mul(settlements[ref].price, settlements[ref].unitsToTransfer);
            if(IERC20(settlements[ref].currency).transferFrom(settlements[ref].transferee, settlements[ref].transferor, pay)){                
                success = IERC20(settlements[ref].security).transferFrom(settlements[ref].transferor, 
                                                                settlements[ref].transferee, 
                                                                settlements[ref].unitsToTransfer);
                if(success){
                    IOrder(settlements[ref].orderPool).orderFilled(settlements[ref].partyRef, settlements[ref].counterpartyRef);
                    ITrade(settlements[ref].orderPool).tradeSettled(ref, settlements[ref].partyRef, settlements[ref].counterpartyRef);
                    emit tradeSettled(settlements[ref].transferor, 
                                        settlements[ref].transferee, 
                                        settlements[ref].unitsToTransfer,
                                        settlements[ref].security,
                                        settlements[ref].price,
                                        settlements[ref].currency
                                    );
                    for(uint i=0; i<trades[id].length; i++){
                        if(trades[id][i]==ref){
                            if(i==trades[id].length-1)
                                delete trades[id][i];
                            else
                                trades[id][i] = trades[id][i+1];
                        }
                    }
                }
                else{
                    IOrder(settlements[ref].orderPool).revertTrade(settlements[ref].partyRef, settlements[ref].unitsToTransfer, "Sell");
                    IOrder(settlements[ref].orderPool).revertTrade(settlements[ref].counterpartyRef, settlements[ref].unitsToTransfer, "Buy");
                    IERC20(settlements[ref].currency).transferFrom(settlements[ref].transferor, settlements[ref].transferee, pay);
                }
            }
        }
        else if(status=="Reject"){
            IOrder(settlements[ref].orderPool).revertTrade(settlements[ref].partyRef, settlements[ref].unitsToTransfer, "Sell");
            IOrder(settlements[ref].orderPool).revertTrade(settlements[ref].counterpartyRef, settlements[ref].unitsToTransfer, "Buy");
        }            
    }

    /**
        Gets transfer agent for any of the parties in the trade
        @param  party         reference to the party or counterparty in a trade
     */
    function getTransferAgent(address party) override external view returns(bytes32){
        return(issuers[msg.sender][party]);
    }

}