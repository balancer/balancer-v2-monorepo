// Interface for orders
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

interface IOrder {

    enum OrderType{ Market, Limit, Stop }

    enum OrderStatus{ Filled, PartlyFilled, Open, Cancelled, Expired }
    
    enum Order{ Buy, Sell } 

    struct order{
        //uint256 orderno; 
        IERC20 tokenIn;
        IERC20 tokenOut;
        OrderType otype;
        Order order;
        OrderStatus status;
        uint256 qty;
        uint256 dt;
        address party;
        uint256 price;  
        uint256 currencyBalance;  
        uint256 securityBalance;    
    }

    function getOrderRef() external view returns(bytes32[] memory);

    function cancelOrder(bytes32 ref) external;

    function editOrder( bytes32 ref,
                        uint256 _price,
                        uint256 _qty) external;

    function revertTrade(bytes32 _orderRef, uint256 _qty, Order _order) external;

    function orderFilled(bytes32 partyRef, bytes32 counterpartyRef) external;
}