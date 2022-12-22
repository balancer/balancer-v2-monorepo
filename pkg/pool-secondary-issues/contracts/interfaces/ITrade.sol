// Interface for trade
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

import "./IOrder.sol";

interface ITrade {

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

}