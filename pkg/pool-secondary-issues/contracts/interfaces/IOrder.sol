// Interface for orders
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

interface IOrder {

    enum OrderType{ Market, Limit, Stop }

    enum OrderStatus{ Filled, PartlyFilled, Open, Cancelled, Expired }
    
    enum Order{ Buy, Sell } 

    struct order{
        IVault.SwapKind swapKind; 
        address tokenIn;
        address tokenOut;
        OrderType otype;
        Order order;
        OrderStatus status;
        uint256 qty;
        address party;
        uint256 price;  
        uint256 currencyBalance;  
        uint256 securityBalance;    
    }

    struct Params {
        OrderType trade;
        uint256 price;
    }

    function getPoolId() external view returns(bytes32);

    function getSecurity() external view returns (address);

    function getCurrency() external view returns (address);

    function getOrderRef() external view returns(bytes32[] memory);

    function cancelOrder(bytes32 ref) external;

    function editOrder( bytes32 ref,
                        uint256 _price,
                        uint256 _qty) external;    

    function orderFilled(bytes32 partyRef, bytes32 counterpartyRef) external;

    function tradeSettled(bytes32 partyRef, bytes32 counterpartyRef) external;

    function revertTrade(bytes32 _orderRef, uint256 _qty, IOrder.Order _order) external;
    
}