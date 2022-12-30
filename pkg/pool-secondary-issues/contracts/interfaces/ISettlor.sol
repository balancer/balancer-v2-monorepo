// Interface for creating secondary trading pools and settling secondary trades
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

import "./ITrade.sol";
import "./IOrder.sol";

interface ISettlor {

    struct settlement{  address transferor;
                        address transferee;
                        address security;
                        bytes32 status;
                        bytes32 transferorDPID;
                        bytes32 transfereeDPID;
                        address currency;
                        uint256 price;
                        uint256 askprice;
                        uint256 unitsToTransfer;
                        uint256 consideration;
                        uint256 executionDate;
                        IOrder orderPool;
                        bytes32 partyRef;
                        bytes32 counterpartyRef;
                    }
    
    function requestSettlement(ITrade.trade memory tradeToReport, IOrder orderbook) external;

    function getTrade(bytes32 ref) external view returns(uint256 b, uint256 a);

}