// Interface for creating secondary trading pools and settling secondary trades
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;
interface ISettlor {

    //enum SettlementStatus { Confirm, Reject, Pending }

    /*enum FeeType {  Regulatory, 
                    Tax,
                    Commission,
                    ExchangeFees,
                    Stamp,
                    Levy,
                    Other,
                    Markup,
                    ConsumptionTax,
                    Transaction, 
                    Conversion,
                    Agent,
                    TransferFee,
                    SecurityLending,
                    TradeReporting, 
                    TaxPrincipalAmount,
                    TaxAccruedInterest,
                    NewIssuanceFee,
                    ServiceFee,
                    VAT,
                    GST
                    }*/
    
    struct settlement{  address transferor;
                        address transferee;
                        address security;
                        bytes32 status;
                        bytes32 transferorDPID;
                        bytes32 transfereeDPID;
                        address currency;
                        uint256 price;
                        uint256 unitsToTransfer;
                        uint256 consideration;
                        uint256 executionDate;
                        address orderPool;
                        bytes32 partyRef;
                        bytes32 counterpartyRef;
                    }
    
    function issueSecondary(address security, address currency, uint256 amount, bytes32 id) external;

    function postSettlement(settlement calldata newTrade, bytes32 ref) external;

    function getSettlementRequests(bytes32 dpid) external view returns(bytes32[] memory);

    function getSettlementRequest(bytes32 ref) external view returns(settlement memory);

    function setSettlementStatus(bytes32 ref, bytes32 status, bytes32 id) external;

    function getTransferAgent(address party) external view returns(bytes32);

}