// Interface for trade
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

import "./IOrder.sol";

interface ITrade {

    /*enum DataType{ Bid, Offer, Trade, OpeningPrice }

    enum ExecutionStatus { Fill, PartialFill }

    enum SettlementType { STP, DP }*/

    struct trade{
        bytes32 partyRef;
        bool partySwapIn;
        string partyTokenIn;
        uint256 partyInAmount;
        address party;
        bytes32 counterpartyRef; 
        bool counterpartySwapIn;
        string counterpartyTokenIn;
        uint256 counterpartyInAmount;
        address counterparty; 
        address security;
        address currency;
        uint256 price;
        IOrder.OrderType otype;
        uint256 dt;
    }

    function tradeSettled(/*bytes32 tradeRef,*/ bytes32 partyRef, bytes32 counterpartyRef) external;

}