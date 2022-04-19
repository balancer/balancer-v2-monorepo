// Interface for orders
//"SPDX-License-Identifier: MIT"

pragma solidity 0.7.1;

interface IOrder {

    /*enum OrderType{ Market, Limit, StopLoss }

    enum OrderStatus{ Filled, PartlyFilled, Open, Cancelled, Expired }
    
    enum Order{ Buy, Sell } 

    enum Status{ Halt, Open }*/

    struct order{
        uint256 orderno; 
        bytes32 otype;
        bytes32 order;
        bytes32 status;
        uint256 qty;
        uint256 dt;
        address party;
        uint256 price;        
    }

    function getOrderRef() external view returns(bytes32[] memory);

    function cancelOrder(bytes32 ref) external;

    function editOrder( bytes32 ref,
                        uint256 _price,
                        uint256 _qty) external;

    function revertTrade(bytes32 _orderRef, uint256 _qty, bytes32 _order) external;

    function orderFilled(bytes32 partyRef, bytes32 counterpartyRef) external;
}