// Interface for trade
//"SPDX-License-Identifier: MIT"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;
interface ITrade {

    /*enum DataType{ Bid, Offer, Trade, OpeningPrice }

    enum ExecutionStatus { Fill, PartialFill }

    enum SettlementType { STP, DP }*/

    struct trade{
        address transferor;
        address transferee;
        address security;
        uint256 price;
        uint256 askprice;
        address currency;
        bytes32 order;
        bytes32 stype;
        uint256 qty;
        uint dt;
    }

    function getTrade(bytes32 ref) external view returns(uint256 b, uint256 a);

    function tradeSettled(bytes32 tradeRef, bytes32 partyRef, bytes32 counterpartyRef) external;

}