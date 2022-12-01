// Implementation of order book for secondary issues of security tokens that support multiple order types
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IOrder.sol";
import "./interfaces/ITrade.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IPoolSwapStructs.sol";

contract Orderbook is IOrder, ITrade, Ownable{
    using Math for uint256;

    //counter for block timestamp nonce for creating unique order references
    uint256 private _previousTs = 0;

    //order references
    bytes32[] private _orderRefs;

    //mapping order reference to order
    mapping(bytes32 => IOrder.order) private orders;

    //mapping order reference to position
    mapping(bytes32 => uint256) private _orderIndex;

    //mapping users to order references
    mapping(address => bytes32[]) private _userOrderRefs;

    //mapping user's order reference to positions
    mapping(bytes32 => uint256) private _userOrderIndex;

    //market order book
    bytes32[] private _marketOrders;

    mapping(bytes32 => uint256) private _marketOrderIndex;

    //limit order book
    bytes32[] private _limitOrders;

    mapping(bytes32 => uint256) private _limitOrderIndex;

    //stop loss order book
    bytes32[] private _stopOrders;

    mapping(bytes32 => uint256) private _stopOrderIndex;

    //swap references from party to order timestamp to return amount
    mapping(address => mapping(uint256 => uint256)) private swapRefs;

    //order matching related    
    uint256 private _bestUnfilledBid;
    uint256 private _bestUnfilledOffer;

    address private immutable _security;
    address private immutable _currency;
    address payable private _balancerManager;

    event CallSwap( bool swapKindParty, string tokenInParty, address party, 
                    bool swapKindCounterparty, string tokenInCounterparty, address counterParty, uint256 swapId); 

    event BestAvailableTrades(uint256 bestUnfilledBid, uint256 bestUnfilledOffer);

    constructor(address balancerManager, address security, address currency){        
        _balancerManager = payable(balancerManager);
        _security = security;
        _currency = currency;
    }

    function newOrder(
        IPoolSwapStructs.SwapRequest memory _request,
        IOrder.Params memory _params,
        IOrder.Order _order,
        uint256[] memory _balances,
        uint256 _currencyIndex,
        uint256 _securityIndex
    ) public onlyOwner {
        require(_params.trade == IOrder.OrderType.Market || _params.trade == IOrder.OrderType.Limit || _params.trade == IOrder.OrderType.Stop);
        require(_order == IOrder.Order.Buy || _order == IOrder.Order.Sell);
        if(block.timestamp == _previousTs)
            _previousTs = _previousTs + 1;
        else
            _previousTs = block.timestamp;
        bytes32 ref = keccak256(abi.encodePacked(_request.from, _previousTs));
        //fill up order details
        IOrder.order memory nOrder = IOrder.order({
            swapKind: _request.kind,
            tokenIn: address(_request.tokenIn),
            tokenOut: address(_request.tokenOut),
            otype: _params.trade,
            order: _order,
            status: IOrder.OrderStatus.Open,
            qty: _request.amount,
            dt: _previousTs,
            party: _request.from,
            price: _params.price,  
            currencyBalance: _balances[_currencyIndex],  
            securityBalance: _balances[_securityIndex]
        });
        orders[ref] = nOrder;
        //fill up indexes
        _orderIndex[ref] = _orderRefs.length;
        _orderRefs.push(ref);
        _userOrderIndex[ref] = _userOrderRefs[_request.from].length;
        _userOrderRefs[_request.from].push(ref);
        if (_params.trade == IOrder.OrderType.Market) {
            orders[ref].status = IOrder.OrderStatus.Open;
            _marketOrderIndex[ref] = _marketOrders.length;
            _marketOrders.push(ref);
            matchOrders(ref, IOrder.OrderType.Market);
        } else if (_params.trade == IOrder.OrderType.Limit) {
            orders[ref].status = IOrder.OrderStatus.Open;
            _limitOrderIndex[ref] = _limitOrders.length;
            _limitOrders.push(ref);
            checkLimitOrders(ref, IOrder.OrderType.Limit);
        } else if (_params.trade == IOrder.OrderType.Stop) {
            orders[ref].status = IOrder.OrderStatus.Open;
            _stopOrderIndex[ref] = _stopOrders.length;
            _stopOrders.push(ref);
            checkStopOrders(ref, IOrder.OrderType.Stop);
        }
    }

    function getOrderRef() external view override returns (bytes32[] memory) {
        return _userOrderRefs[msg.sender];
    }

    function editOrder(
        bytes32 ref,
        uint256 _price,
        uint256 _qty
    ) external override {
        require(orders[ref].status == IOrder.OrderStatus.Open, "Order is already filled");
        require(orders[ref].party == msg.sender, "Sender is not order creator");
        orders[ref].price = _price;
        orders[ref].qty = _qty;
        if (orders[ref].otype == IOrder.OrderType.Limit) {
            //_limitOrderIndex[ref] = _limitOrders.length; 
            //_limitOrders.push(ref); //Paras : why are we again pushing orders to the order book when we are editing them ?            
            checkLimitOrders(ref, IOrder.OrderType.Limit);
        } else if (orders[ref].otype == IOrder.OrderType.Stop) {
            //_stopOrderIndex[ref] = _stopOrders.length;
            //_stopOrders.push(ref); //Paras : why are we again pushing orders to the order book when we are editing them ?
            checkStopOrders(ref, IOrder.OrderType.Stop);
        }        
    }

    function cancelOrder(bytes32 ref) external override {
        require(orders[ref].party == msg.sender, "Sender is not order creator");
        delete _marketOrders[_marketOrderIndex[ref]];
        delete _marketOrderIndex[ref];
        delete _limitOrders[_limitOrderIndex[ref]];
        delete _limitOrderIndex[ref];
        delete _stopOrders[_stopOrderIndex[ref]];
        delete _stopOrderIndex[ref];
        delete orders[ref];
        delete _orderRefs[_orderIndex[ref]];
        delete _orderIndex[ref];
        delete _userOrderRefs[msg.sender][_userOrderIndex[ref]];
        delete _userOrderIndex[ref];
    }

    //check if a buy order in the limit order book can execute over the prevailing (low) price passed to the function
    //check if a sell order in the limit order book can execute under the prevailing (high) price passed to the function
    function checkLimitOrders(bytes32 _ref, IOrder.OrderType _trade) private {
        bytes32 ref;
        for (uint256 i = 0; i < _limitOrders.length; i++) {
            if ((orders[_limitOrders[i]].order == IOrder.Order.Buy && orders[_limitOrders[i]].price >= orders[_ref].price) ||
                (orders[_limitOrders[i]].order == IOrder.Order.Sell && orders[_limitOrders[i]].price <= orders[_ref].price)){
                _marketOrders.push(_limitOrders[i]);
                ref = _limitOrders[i];
                reorder(i, IOrder.OrderType.Limit);
                if(ref == 0) continue; //Paras : why have we added this ?    
                if(_trade!=IOrder.OrderType.Market && ref!=_ref){
                //only if the consecutive order is a limit order, it goes to the market order book
                    _marketOrders.push(_ref);
                    reorder(_limitOrderIndex[_ref], IOrder.OrderType.Limit);
                }        
                matchOrders(ref, IOrder.OrderType.Limit);
            } 
        }
    }
    
    //check if a buy order in the stoploss order book can execute under the prevailing (high) price passed to the function
    //check if a sell order in the stoploss order book can execute over the prevailing (low) price passed to the function
    function checkStopOrders(bytes32 _ref, IOrder.OrderType _trade) private {
        bytes32 ref;
        for (uint256 i = 0; i < _stopOrders.length; i++) {
            if ((orders[_stopOrders[i]].order == IOrder.Order.Buy && orders[_stopOrders[i]].price <= orders[_ref].price) ||
                (orders[_stopOrders[i]].order == IOrder.Order.Sell && orders[_stopOrders[i]].price >= orders[_ref].price)){
                _marketOrders.push(_stopOrders[i]);
                ref = _stopOrders[i];
                reorder(i, IOrder.OrderType.Stop);
                if(ref == 0) continue; // Paras : why have we added this ?     
                if(_trade!=IOrder.OrderType.Market && ref!=_ref){
                    //only if the consecutive order is a stop loss order, it goes to the market order book
                    _marketOrders.push(_ref);
                    reorder(_stopOrderIndex[_ref], IOrder.OrderType.Stop);
                }           
                matchOrders(ref, IOrder.OrderType.Stop);
            } 
        }
    }

    function reorder(uint256 position, IOrder.OrderType list) private {
        if (list == IOrder.OrderType.Market) {
            for (uint256 i = position; i < _marketOrders.length; i++) {
                if (i == _marketOrders.length - 1){ 
                    delete _marketOrders[position];
                }
                else _marketOrders[position] = _marketOrders[position + 1];
            }
        } else if (list == IOrder.OrderType.Limit) {
            for (uint256 i = position; i < _limitOrders.length; i++) {
                if (i == _limitOrders.length - 1) {
                    delete _limitOrders[position];
                }
                else _limitOrders[position] = _limitOrders[position + 1];
            }
        } else if (list == IOrder.OrderType.Stop) {
            for (uint256 i = position; i < _stopOrders.length; i++) {
                if (i == _stopOrders.length - 1) {
                    delete _stopOrders[position];
                }
                else _stopOrders[position] = _stopOrders[position + 1];
            }
        }
    }

    //match market orders. Sellers get the best price (highest bid) they can sell at.
    //Buyers get the best price (lowest offer) they can buy at.
    function matchOrders(bytes32 _ref, IOrder.OrderType _trade) private {
        bytes32 _bestBid;
        uint256 _bestBidPrice = 0;
        bytes32 _bestOffer;
        uint256 _bestOfferPrice = 0;
        uint256 _bidIndex = 0;
        for (uint256 i = 0; i < _marketOrders.length; i++) {
            if (
                _marketOrders[i] != _ref && //orders can not be matched with themselves
                orders[_marketOrders[i]].party != orders[_ref].party && //orders posted by a party can not be matched by a counter offer by the same party
                orders[_marketOrders[i]].status != IOrder.OrderStatus.Filled //orders that are filled can not be matched /traded again
            ) {
                if (orders[_marketOrders[i]].order == IOrder.Order.Buy && orders[_ref].order == IOrder.Order.Sell) {
                    if (orders[_marketOrders[i]].price >= orders[_ref].price || orders[_ref].price == 0) {
                        if (orders[_marketOrders[i]].price > _bestBidPrice || _bestBidPrice == 0) {
                            _bestUnfilledBid = _bestBidPrice;
                            _bestBidPrice = orders[_marketOrders[i]].price;
                            _bestBid = _orderRefs[i];
                            _bidIndex = i;
                        }
                        //orders[_ref].price = orders[_ref].price == 0 ? orders[_bestBid].price : orders[_ref].price; //Paras : shouldn't orders[_ref].price be what the best bid is ?
                    }
                } else if (orders[_marketOrders[i]].order == IOrder.Order.Sell && orders[_ref].order == IOrder.Order.Buy) {
                    // orders[_ref].price == 0 condition check for Market Order with 0 Price
                    if (orders[_marketOrders[i]].price <= orders[_ref].price || orders[_ref].price == 0) {
                        if (orders[_marketOrders[i]].price < _bestOfferPrice || _bestOfferPrice == 0) {
                            _bestUnfilledOffer = _bestOfferPrice;
                            _bestOfferPrice = orders[_marketOrders[i]].price;
                            _bestOffer = _orderRefs[i];
                            _bidIndex = i;
                        }
                        //orders[_ref].price = orders[_ref].price == 0 ? orders[_bestOffer].price : orders[_ref].price;
                    }
                }
            }
        }
        uint256 securityTraded;
        uint256 currencyTraded;
        if (orders[_ref].order == IOrder.Order.Sell) {               
            if (_bestBid != "") {
                if(orders[_ref].tokenIn==_security && orders[_ref].swapKind==IVault.SwapKind.GIVEN_IN && orders[_ref].securityBalance>=orders[_ref].qty){
                    if(orders[_bestBid].tokenIn==_currency && orders[_bestBid].swapKind==IVault.SwapKind.GIVEN_IN){
                        securityTraded = Math.div(orders[_bestBid].qty, _bestBidPrice, false); // calculating amount of security that can be brought
                    }else if (orders[_bestBid].tokenOut==_security && orders[_bestBid].swapKind==IVault.SwapKind.GIVEN_OUT){
                        securityTraded = orders[_bestBid].qty; // amount of security brought (tokenOut) is already there 
                    }
                    if(securityTraded >= orders[_ref].qty){
                        currencyTraded = Math.mul(orders[_ref].qty, _bestBidPrice);
                        orders[_bestBid].qty = orders[_bestBid].tokenIn==_currency ? 
                                                Math.sub(orders[_bestBid].qty, currencyTraded) : Math.sub(orders[_bestBid].qty, orders[_ref].qty);
                        orders[_ref].qty = 0;
                        orders[_bestBid].status = IOrder.OrderStatus.PartlyFilled;
                        orders[_ref].status = IOrder.OrderStatus.Filled;  
                        reorder(_marketOrders.length-1, _trade); //order ref is removed from market order list as its qty becomes zero
                    }    
                    else{
                        currencyTraded = Math.mul(securityTraded, _bestBidPrice);
                        orders[_ref].qty = Math.sub(orders[_ref].qty, securityTraded);
                        orders[_bestBid].qty = 0;
                        orders[_bestBid].status = IOrder.OrderStatus.Filled;
                        orders[_ref].status = IOrder.OrderStatus.PartlyFilled;
                        reorder(_bidIndex, orders[_marketOrders[_bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                    }
                }
                else if(orders[_ref].tokenOut==_currency && orders[_ref].swapKind==IVault.SwapKind.GIVEN_OUT){
                    if(orders[_bestBid].tokenOut==_security && orders[_bestBid].swapKind==IVault.SwapKind.GIVEN_OUT){
                        currencyTraded = Math.mul(orders[_bestBid].qty, _bestBidPrice); // calculating amount of currency that needs to be sent in to buy security (tokenOut)
                    }else if(orders[_bestBid].tokenIn==_currency && orders[_bestBid].swapKind==IVault.SwapKind.GIVEN_IN){
                        currencyTraded = orders[_bestBid].qty; // amount of currency sent in (tokenIn) is already there
                    }
                    if(currencyTraded >= orders[_bestBid].qty){
                        securityTraded = Math.div(currencyTraded, _bestBidPrice, false);
                        orders[_bestBid].qty = orders[_bestBid].tokenOut==_security ? 
                                                Math.sub(orders[_bestBid].qty, securityTraded) : Math.sub(orders[_bestBid].qty, orders[_ref].qty);
                        orders[_ref].qty = 0;
                        orders[_bestBid].status = IOrder.OrderStatus.PartlyFilled;
                        orders[_ref].status = IOrder.OrderStatus.Filled;  
                        reorder(_marketOrders.length-1, _trade); //order ref is removed from market order list as its qty becomes zero
                    }    
                    else{
                        securityTraded = Math.div(currencyTraded, _bestBidPrice, false);
                        orders[_ref].qty = Math.sub(orders[_ref].qty, currencyTraded);
                        orders[_bestBid].qty = 0;
                        orders[_bestBid].status = IOrder.OrderStatus.Filled;
                        orders[_ref].status = IOrder.OrderStatus.PartlyFilled;                        
                        reorder(_bidIndex, orders[_marketOrders[_bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                    }
                }                 
                swapRefs[orders[_ref].party][orders[_ref].dt] = orders[_ref].tokenIn==_security ? securityTraded : currencyTraded;
                swapRefs[orders[_bestBid].party][orders[_ref].dt] = orders[_bestBid].tokenIn==_security ? securityTraded : currencyTraded;
                _bidIndex = orders[_ref].dt;
                emit CallSwap(  orders[_ref].swapKind==IVault.SwapKind.GIVEN_IN ? true : false,
                                orders[_ref].tokenIn==_security ? "security" : "currency",
                                orders[_ref].party, 
                                orders[_bestBid].swapKind==IVault.SwapKind.GIVEN_IN ? true : false,
                                orders[_bestBid].tokenIn==_security ? "security" : "currency",
                                orders[_bestBid].party, 
                                _bidIndex
                            );
            }
            else if(_trade==IOrder.OrderType.Market){ 
                checkLimitOrders(_ref, _trade);
                checkStopOrders(_ref, _trade);
            }
        } 
        else if (orders[_ref].order == IOrder.Order.Buy){            
            if (_bestOffer != "") {
                if(orders[_ref].tokenIn==_currency && orders[_ref].swapKind==IVault.SwapKind.GIVEN_IN && orders[_ref].currencyBalance>=orders[_ref].qty){
                    if(orders[_bestOffer].tokenIn==_security && orders[_bestOffer].swapKind==IVault.SwapKind.GIVEN_IN){
                        currencyTraded = Math.mul(orders[_bestOffer].qty, _bestOfferPrice); // calculating amount of currency that can taken out    
                    } else if (orders[_bestOffer].tokenOut==_currency && orders[_bestOffer].swapKind==IVault.SwapKind.GIVEN_OUT){
                        currencyTraded = orders[_bestOffer].qty; // amount of currency to take out (tokenOut) is already there 
                    }
                    if(currencyTraded >= orders[_ref].qty){
                        securityTraded = Math.div(orders[_ref].qty, _bestOfferPrice, false);
                        orders[_bestOffer].qty = orders[_bestOffer].tokenOut==_currency ? 
                                                Math.sub(orders[_bestOffer].qty, orders[_ref].qty) : Math.sub(currencyTraded, orders[_ref].qty);
                        orders[_ref].qty = 0;
                        orders[_bestOffer].status = IOrder.OrderStatus.PartlyFilled;
                        orders[_ref].status = IOrder.OrderStatus.Filled;  
                        reorder(_marketOrders.length-1, _trade); //order ref is removed from market order list as its qty becomes zero
                    }    
                    else{
                        securityTraded = Math.div(currencyTraded, _bestOfferPrice, false);
                        orders[_ref].qty = Math.sub(orders[_ref].qty, currencyTraded);
                        orders[_bestOffer].qty = 0;
                        orders[_bestOffer].status = IOrder.OrderStatus.Filled;
                        orders[_ref].status = IOrder.OrderStatus.PartlyFilled;                        
                        reorder(_bidIndex, orders[_marketOrders[_bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                    }                    
                }
                else if(orders[_ref].tokenOut==_security && orders[_ref].swapKind==IVault.SwapKind.GIVEN_OUT){
                    if(orders[_bestOffer].tokenOut==_currency && orders[_bestOffer].swapKind==IVault.SwapKind.GIVEN_OUT){
                        securityTraded = Math.div(orders[_bestOffer].qty, _bestOfferPrice, false); // calculating amount of security that needs to be sent in to take out currency (tokenOut)
                    } else if(orders[_bestOffer].tokenIn==_security && orders[_bestOffer].swapKind==IVault.SwapKind.GIVEN_IN){
                        securityTraded = orders[_bestOffer].qty; // amount of security sent in (tokenIn) is already there
                    }
                    if(securityTraded >= orders[_ref].qty){
                        currencyTraded = Math.mul(orders[_ref].qty, _bestOfferPrice);
                        orders[_bestOffer].qty = orders[_bestOffer].tokenIn==_security ? 
                                                Math.sub(securityTraded, orders[_bestOffer].qty) : Math.sub(orders[_bestOffer].qty, orders[_ref].qty);
                        orders[_ref].qty = 0;
                        orders[_bestOffer].status = IOrder.OrderStatus.PartlyFilled;
                        orders[_ref].status = IOrder.OrderStatus.Filled;  
                        reorder(_marketOrders.length-1, _trade); //order ref is removed from market order list as its qty becomes zero
                    }    
                    else{
                        currencyTraded = Math.mul(securityTraded, _bestOfferPrice);
                        orders[_ref].qty = Math.sub(orders[_ref].qty, securityTraded);
                        orders[_bestOffer].qty = 0;
                        orders[_bestOffer].status = IOrder.OrderStatus.Filled;
                        orders[_ref].status = IOrder.OrderStatus.PartlyFilled;
                        reorder(_bidIndex, orders[_marketOrders[_bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                    }
                }                
                swapRefs[orders[_ref].party][orders[_ref].dt] = orders[_ref].tokenIn==_security ? securityTraded : currencyTraded;
                swapRefs[orders[_bestOffer].party][orders[_ref].dt] = orders[_bestOffer].tokenIn==_security ? securityTraded : currencyTraded;
                _bidIndex = orders[_ref].dt;
                emit CallSwap(  orders[_ref].swapKind==IVault.SwapKind.GIVEN_IN ? true : false,
                                orders[_ref].tokenIn==_security ? "security" : "currency",
                                orders[_ref].party, 
                                orders[_bestOffer].swapKind==IVault.SwapKind.GIVEN_IN ? true : false,
                                orders[_bestOffer].tokenIn==_security ? "security" : "currency", 
                                orders[_bestOffer].party, 
                                _bidIndex
                            );                
            }
            else if(_trade==IOrder.OrderType.Market){
                checkLimitOrders(_ref, _trade);
                checkStopOrders(_ref, _trade);
            }
        }
    }

    function revertTrade(
        bytes32 _orderRef,
        uint256 _qty,
        Order _order
    ) external override {
        require(_balancerManager == msg.sender);
        require(_order == Order.Buy || _order == Order.Sell);
        orders[_orderRef].qty = orders[_orderRef].qty + _qty;
        orders[_orderRef].status = OrderStatus.Open;
        //push to order book
    }

    function orderFilled(bytes32 partyRef, bytes32 counterpartyRef) external override {
        require(_balancerManager == msg.sender);
        delete _userOrderRefs[orders[partyRef].party][_userOrderIndex[partyRef]];
        delete _userOrderIndex[partyRef];
        delete orders[partyRef];
        delete _orderRefs[_orderIndex[partyRef]];
        delete _orderIndex[partyRef];
        delete _userOrderRefs[orders[counterpartyRef].party][_userOrderIndex[counterpartyRef]];
        delete _userOrderIndex[counterpartyRef];
        delete orders[counterpartyRef];
        delete _orderRefs[_orderIndex[counterpartyRef]];
        delete _orderIndex[counterpartyRef];
    }

    function tradeSettled(
        //bytes32 tradeRef,
        bytes32 partyRef,
        bytes32 counterpartyRef
    ) external override {
        require(_balancerManager == msg.sender);
        //delete _trades[tradeRef];
        orders[partyRef].status = OrderStatus.Filled;
        orders[counterpartyRef].status = OrderStatus.Filled;
    }

}