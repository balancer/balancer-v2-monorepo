// Implementation of order book for secondary issues of security tokens that support multiple order types
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IOrder.sol";
import "./interfaces/ITrade.sol";
import "./interfaces/ISecondaryIssuePool.sol";
import "./interfaces/Heap.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IPoolSwapStructs.sol";





contract Orderbook is IOrder, ITrade, Ownable{
    using FixedPoint for uint256;

    //counter for block timestamp nonce for creating unique order references
    uint256 private _previousTs = 0;

    //mapping order reference to order
    mapping(bytes32 => IOrder.order) private _orders;

    //mapping order type to order references
    mapping(bytes32 => bytes32[]) private _orderbook;

    mapping(bytes32 => uint256) private _orderIndex;

    //order references from party to order timestamp
    mapping(address => mapping(uint256 => ITrade.trade)) private _tradeRefs;

    //mapping parties to trade time stamps
    mapping(address => uint256[]) private _trades;

    mapping(bytes32 => Heap) public _heaps;




    address private _security;
    address private _currency;
    address payable private _balancerManager;
    address private _pool;

    constructor(address balancerManager, address security, address currency, address pool){
        _balancerManager = payable(balancerManager);
        _security = security;
        _currency = currency;
        _pool = pool;
    }




    function getPoolId() external override view returns(bytes32){
        bytes32 _poolId = ISecondaryIssuePool(_pool).getPoolId();
        return _poolId;
    }

    function getSecurity() external override view returns (address) {
        return _security;
    }

    function getCurrency() external override view returns (address) {
        return _currency;
    }

    function newOrder(
        IPoolSwapStructs.SwapRequest memory _request,
        IOrder.Params memory _params,
        IOrder.Order _order
    ) public onlyOwner returns (uint256){
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
        party: _request.from,
        price: _params.price,
        ref: ref
        });
        _orders[ref] = nOrder;
        if (_params.trade == IOrder.OrderType.Market) {
            return matchOrders(nOrder, IOrder.OrderType.Market);
        } else if (_params.trade == IOrder.OrderType.Limit) {
            Heap heap = new Heap();
            heap.push(uint(ref));
            _heaps["Limit"].push(uint(ref));
            return matchOrders(nOrder, IOrder.OrderType.Limit);
        } else if (_params.trade == IOrder.OrderType.Stop) {
            Heap heap = new Heap();
            heap.push(uint(ref));
            _heaps["Stop"].push(uint(ref));
            return matchOrders(nOrder, IOrder.OrderType.Stop);
        }
    }


    function getOrderRef() external view override returns (bytes32[] memory) {
        bytes32[] memory refs = new bytes32[](Math.add(_orderbook["Limit"].length, _orderbook["Stop"].length));
        uint256 i;
        for(uint256 j=0; j<_orderbook["Limit"].length; j++){
            if(_orders[_orderbook["Limit"][j]].party==msg.sender){
                refs[i] = _orderbook["Limit"][j];
                i++;
            }
        }
        for(uint256 j=0; j<_orderbook["Stop"].length; j++){
            if(_orders[_orderbook["Stop"][j]].party==msg.sender){
                refs[i] = _orderbook["Stop"][j];
                i++;
            }
        }
        return refs;
    }

    function editOrder(
        bytes32 ref,
        uint256 _price,
        uint256 _qty
    ) external override {
        require (_orders[ref].otype != IOrder.OrderType.Market, "Market order can not be changed");
        require(_orders[ref].status == IOrder.OrderStatus.Open, "Order is already filled");
        require(_orders[ref].party == msg.sender, "Sender is not order creator");
        _orders[ref].price = _price;
        _orders[ref].qty = _qty;
        if (_orders[ref].otype == IOrder.OrderType.Limit) {
            checkLimitOrders(ref, IOrder.OrderType.Limit);
        } else if (_orders[ref].otype == IOrder.OrderType.Stop) {
            bytes32[] memory a;
            checkStopOrders(ref, IOrder.OrderType.Stop, 0, a);
        }
    }

    function cancelOrder(bytes32 ref) external override {
        require (_orders[ref].otype != IOrder.OrderType.Market, "Market order can not be cancelled");
        require(_orders[ref].status == IOrder.OrderStatus.Open, "Order is already filled");
        require(_orders[ref].party == msg.sender, "Sender is not order creator");
        if (_orderbook["Limit"].length > 0)
        {
            delete _orderbook["Limit"][_orderIndex[ref]];
        }
        if (_orderbook["Stop"].length > 0)
        {
            delete _orderbook["Stop"][_orderIndex[ref]];
        }
        delete _orderIndex[ref];
        delete _orders[ref];
    }

    //check if a buy order in the limit order book can execute over the prevailing (low) price passed to the function
    //check if a sell order in the limit order book can execute under the prevailing (high) price passed to the function
    function checkLimitOrders(bytes32 _ref, IOrder.OrderType _trade) private view returns (uint256, bytes32[] memory){
        uint256 volume;
        bytes32[] memory _marketOrders = new bytes32[](_orderbook["Limit"].length);
        uint256 index;
        for (uint256 i = 0; i < _orderbook["Limit"].length; i++){
            if(_orderbook["Limit"][i] == 0) continue;
            if ((_orders[_orderbook["Limit"][i]].order == IOrder.Order.Buy && _orders[_ref].order == IOrder.Order.Sell && (_orders[_orderbook["Limit"][i]].price >= _orders[_ref].price || _orders[_ref].price==0)) ||
                (_orders[_orderbook["Limit"][i]].order == IOrder.Order.Sell && _orders[_ref].order == IOrder.Order.Buy && (_orders[_orderbook["Limit"][i]].price <= _orders[_ref].price || _orders[_ref].price==0))){
                _marketOrders[index] = _orderbook["Limit"][i];
                volume = Math.add(volume, _orders[_orderbook["Limit"][i]].price.mulDown(_orders[_orderbook["Limit"][i]].qty));
                if(_trade!=IOrder.OrderType.Market && _trade!=IOrder.OrderType.Stop && _orderbook["Limit"][i]!=_ref){
                    //only if the consecutive order is a limit order, it goes to the market order book
                    _marketOrders[index+1] = _ref;
                }
                index++;
            }
        }
        return (volume, _marketOrders);
    }

    //check if a buy order in the stoploss order book can execute under the prevailing (high) price passed to the function
    //check if a sell order in the stoploss order book can execute over the prevailing (low) price passed to the function
    function checkStopOrders(bytes32 _ref, IOrder.OrderType _trade, uint256 _volume, bytes32[] memory _marketOrders) private view returns (uint256, bytes32[] memory){
        uint256 volume;
        bytes32[] memory marketOrders;
        uint256 i;
        uint256 index = _marketOrders.length;
        if(_volume>0){
            volume = volume + _volume;
        }
        if(index>0){
            marketOrders = new bytes32[](Math.add(_orderbook["Limit"].length, _orderbook["Stop"].length));
            for(i=0; i<_marketOrders.length; i++){
                marketOrders[i] = _marketOrders[i];
            }
        }
        else{
            marketOrders = new bytes32[](_orderbook["Stop"].length);
        }
        for (i = 0; i < _orderbook["Stop"].length; i++) {
            if(_orderbook["Stop"][i] == 0) continue;
            if ((_orders[_orderbook["Stop"][i]].order == IOrder.Order.Buy && _orders[_ref].order == IOrder.Order.Sell && (_orders[_orderbook["Stop"][i]].price <= _orders[_ref].price || _orders[_ref].price==0)) ||
                (_orders[_orderbook["Stop"][i]].order == IOrder.Order.Sell && _orders[_ref].order == IOrder.Order.Buy && (_orders[_orderbook["Stop"][i]].price >= _orders[_ref].price || _orders[_ref].price==0))){
                marketOrders[index] = _orderbook["Stop"][i];
                volume = Math.add(volume, _orders[_orderbook["Stop"][i]].price.mulDown(_orders[_orderbook["Stop"][i]].qty));
                if(_trade!=IOrder.OrderType.Market && _trade!=IOrder.OrderType.Limit && _orderbook["Stop"][i]!=_ref){
                    //only if the consecutive order is a stop loss order, it goes to the market order book
                    marketOrders[index+1] = _ref;
                }
                index++;
            }
        }
        return (volume, marketOrders);
    }

    function reorder(uint256 position, IOrder.OrderType list) private {
        if (list == IOrder.OrderType.Limit) {
            bytes32 securityKey = keccak256(abi.encodePacked([_security]));
            Heap heap = _heaps[securityKey];

        for (uint256 i = position + 1; i < _orderbook["Limit"].length; i++) {
                heap.push(uint(_orderbook["Limit"][i]));
            }
            delete _orderbook["Limit"][position];
            while (heap.nodes.length > 0) {
                _orderbook["Limit"][position] = heap.pop();
                position++;
            }
        } else if (list == IOrder.OrderType.Stop) {
            Heap heap = _heaps[_security];
            for (uint256 i = position + 1; i < _orderbook["Stop"].length; i++) {
                heap.push(uint(_orderbook["Stop"][i]));
            }
            delete _orderbook["Stop"][position];
            while (heap.nodes.length > 0) {
                _orderbook["Stop"][position] = heap.pop();
                position++;
            }
        }
    }




    // Modify the above matchOrders function usig heap data structure
    function matchOrders(IOrder.order memory _order, IOrder.OrderType _trade) private returns (uint256){

        bytes32 bestBid;
        uint256 bestPrice = 0;
        bytes32 bestOffer;
        uint256 bidIndex = 0;
        uint256 securityTraded;
        uint256 currencyTraded;
        uint256 i;

        // Add counter variable
        uint256 counter = 0;
        // Set maximum number of orders that can be processed in a single call
        uint256 maxOrders = 10;

        // Use a heap data structure to store the market orders
        Heap marketOrders = new Heap();



        //check if enough market volume exist to fulfil market orders, or if market depth is zero
        (i, marketOrders) = checkLimitOrders(_order.ref, _trade);
        (i, marketOrders) = checkStopOrders(_order.ref, _trade, i, marketOrders);
        if(_trade==IOrder.OrderType.Market){
            if(i < _order.qty)
                return 0;
        }
        else if(_trade==IOrder.OrderType.Limit || _trade==IOrder.OrderType.Stop){
            if(i==0)
                return 0;
        }

        //if market depth exists, then fill order at one or more price points in the order book
        // Iterate until the heap is empty or we have found a match for the order
        while (marketOrders.size() > 0 && bestPrice == 0) {

            // Check if the counter has reached the maximum number of orders that can be processed in a single call

            if (counter >= maxOrders) {
                break;
            }
            // Get the order at the top of the heap (the one with the highest priority)
            bytes32 marketOrder = marketOrders.top();
            marketOrders.pop();

            if (
                marketOrder != _order.ref && //orders can not be matched with themselves
                _orders[marketOrder].party != _order.party && //orders posted by a party can not be matched by a counter offer by the same party
                _orders[marketOrder].status != IOrder.OrderStatus.Filled //orders that are filled can not be matched /traded again
            ) {
                if (_orders[marketOrder].price == 0 && _order.price == 0) continue; // Case: If Both CP & Party place Order@CMP
                if (_orders[marketOrder].order == IOrder.Order.Buy && _order.order == IOrder.Order.Sell) {
                    if (_orders[marketOrder].price >= _order.price || _order.price == 0) {
                        bestPrice = _orders[marketOrder].price;
                        bestBid = marketOrder;
                        bidIndex = i;
                    }
                } else if (_orders[marketOrder].order == IOrder.Order.Sell && _order.order == IOrder.Order.Buy) {
                    // _order.price == 0 condition check for Market Order with 0 Price
                    if (_orders[marketOrder].price <= _order.price || _order.price == 0) {
                        bestPrice = _orders[marketOrder].price;
                        bestOffer = marketOrder;
                        bidIndex = i;
                    }
                }
            }
            counter++;
        }

        if (_order.order == IOrder.Order.Sell) {
            if (bestBid != "") {
                if(_order.tokenIn==_security && _order.swapKind==IVault.SwapKind.GIVEN_IN){
                    if(_orders[bestBid].tokenIn==_currency && _orders[bestBid].swapKind==IVault.SwapKind.GIVEN_IN){
                        securityTraded = _orders[bestBid].qty.divDown(bestPrice); // calculating amount of security that can be brought
                    }else if (_orders[bestBid].tokenOut==_security && _orders[bestBid].swapKind==IVault.SwapKind.GIVEN_OUT){
                        securityTraded = _orders[bestBid].qty; // amount of security brought (tokenOut) is already there
                    }
                    if(securityTraded >= _order.qty){
                        securityTraded = _order.qty;
                        currencyTraded = _order.qty.mulDown(bestPrice);
                        _orders[bestBid].qty = _orders[bestBid].tokenIn ==_currency &&  _orders[bestBid].swapKind == IVault.SwapKind.GIVEN_OUT ?
                        Math.sub(_orders[bestBid].qty, _order.qty) : Math.sub(_orders[bestBid].qty, currencyTraded);
                        _orders[bestBid].status = _orders[bestBid].qty == 0 ? IOrder.OrderStatus.Filled : IOrder.OrderStatus.PartiallyFilled;
                    }else{
                        _orders[bestBid].qty = 0;
                        _orders[bestBid].status = IOrder.OrderStatus.Filled;
                        securityTraded = _orders[bestBid].qty;
                        currencyTraded = _orders[bestBid].qty.mulDown(bestPrice);
                    }
                }else if(_order.tokenOut==_security && _order.swapKind==IVault.SwapKind.GIVEN_OUT){
                    if(_orders[bestBid].tokenOut==_security && _orders[bestBid].swapKind==IVault.SwapKind.GIVEN_OUT){
                        securityTraded = _orders[bestBid].qty;
                    }else if(_orders[bestBid].tokenIn==_security && _orders[bestBid].swapKind==IVault.SwapKind.GIVEN_IN){
                        securityTraded = Math.mul(_orders[bestBid].qty, bestPrice); // calculating amount of security that can be sold
                    }
                    if(securityTraded >= _order.qty){
                        securityTraded = _order.qty;
                        currencyTraded = Math.mul(_order.qty, bestPrice);
                        _orders[bestBid].qty = _orders[bestBid].tokenOut ==_security && _orders[bestBid].swapKind == IVault.SwapKind.GIVEN_IN ?
                        Math.sub(_orders[bestBid].qty, securityTraded) : Math.sub(_orders[bestBid].qty, currencyTraded);
                        _orders[bestBid].status = _orders[bestBid].qty == 0 ? IOrder.OrderStatus.Filled :IOrder.OrderStatus.PartiallyFilled;
                    }else{
                        _orders[bestBid].qty = 0;
                        _orders[bestBid].status = IOrder.OrderStatus.Filled;
                        securityTraded = _orders[bestBid].qty;
                        currencyTraded = Math.mul(_orders[bestBid].qty, bestPrice);
                    }
                }
                _order.qty = Math.sub(_order.qty, securityTraded);
                _order.status = _order.qty == 0 ? IOrder.OrderStatus.Filled : IOrder.OrderStatus.PartiallyFilled;
                _orders[bestBid].party.transfer(currencyTraded);
                _orders[_order.ref].party.transfer(_order.tokenIn==_security ? securityTraded : currencyTraded);
                reportTrade(_order.ref, bestBid, bestPrice, securityTraded, currencyTraded);
                marketOrders[bidIndex] = marketOrders[marketOrders.length - 1];
                marketOrders.pop();
            }
        } else if (_order.order == IOrder.Order.Buy) {
            if (bestOffer != "") {
                if(_order.tokenIn==_security && _order.swapKind==IVault.SwapKind.GIVEN_IN){
                    if(_orders[bestOffer].tokenIn==_currency && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_IN){
                        securityTraded = _orders[bestOffer].qty.divDown(bestPrice); // calculating amount of security that can be brought
                    }else if (_orders[bestOffer].tokenOut==_security && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_OUT){
                        securityTraded = _orders[bestOffer].qty; // amount of security brought (tokenOut) is already there
                    }
                    if(securityTraded >= _order.qty){
                        securityTraded = _order.qty;
                        currencyTraded = _order.qty.mulDown(bestPrice);
                        _orders[bestOffer].qty = _orders[bestOffer].tokenIn ==_currency &&  _orders[bestOffer].swapKind == IVault.SwapKind.GIVEN_OUT ?
                        Math.sub(_orders[bestOffer].qty, _order.qty) : Math.sub(_orders[bestOffer].qty, currencyTraded);
                        _orders[bestOffer].status = _orders[bestOffer].qty == 0 ? IOrder.OrderStatus.Filled : IOrder.OrderStatus.PartiallyFilled;
                    }else{
                        _orders[bestOffer].qty = 0;
                        _orders[bestOffer].status = IOrder.OrderStatus.Filled;
                        securityTraded = _orders[bestOffer].qty;
                        currencyTraded = _orders[bestOffer].qty.mulDown(bestPrice);
                    }
                }else if(_order.tokenOut==_security && _order.swapKind==IVault.SwapKind.GIVEN_OUT){
                    if(_orders[bestOffer].tokenOut==_security && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_OUT){
                        securityTraded = _orders[bestOffer].qty;
                    }else if(_orders[bestOffer].tokenIn==_security && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_IN){
                        securityTraded = _orders[bestOffer].qty.divDown(bestPrice); // calculating amount of security that can be brought
                    }
                    if(securityTraded >= _order.qty){
                        securityTraded = _order.qty;
                        currencyTraded = _order.qty.mulDown(bestPrice);
                        _orders[bestOffer].qty = _orders[bestOffer].tokenOut ==_security && _orders[bestOffer].swapKind == IVault.SwapKind.GIVEN_IN ?
                        Math.sub(_orders[bestOffer].qty, securityTraded) : Math.sub(_orders[bestOffer].qty, currencyTraded);
                        _orders[bestOffer].status = _orders[bestOffer].qty == 0 ? IOrder.OrderStatus.Filled : IOrder.OrderStatus.PartiallyFilled;
                    }else if(securityTraded!=0){
                        _orders[bestOffer].qty = 0;
                        _orders[bestOffer].status = IOrder.OrderStatus.Filled;
                        currencyTraded = _orders[bestOffer].qty.mulDown(bestPrice);

                    }

                    else{
                        _orders[bestOffer].qty = 0;
                        _orders[bestOffer].status = IOrder.OrderStatus.Filled;
                        securityTraded = _orders[bestOffer].qty;
                        currencyTraded = _orders[bestOffer].qty.mulDown(bestPrice);
                    }



                }


            }



        }

        delete _marketOrders;



    }

    function reportTrade(bytes32 _ref, bytes32 _cref, uint256 _price, uint256 securityTraded, uint256 currencyTraded) private {
        ITrade.trade memory tradeToReport = ITrade.trade({
        partyRef: _ref,
        partyInAmount: _orders[_ref].tokenIn==_security ? securityTraded : currencyTraded,
        partyAddress:  _orders[_ref].party,
        counterpartyRef: _cref,
        counterpartyInAmount: _orders[_cref].tokenIn==_security ? securityTraded : currencyTraded,
        price: _price,
        dt: now
        });

        uint index = _trades[_orders[_ref].party].push(tradeToReport) - 1;
        _tradeRefs[_orders[_ref].party][index] = tradeToReport;
        _heaps[_orders[_ref].party].push(index);

        index = _trades[_orders[_cref].party].push(tradeToReport) - 1;
        _tradeRefs[_orders[_cref].party][index] = tradeToReport;
        _heaps[_orders[_cref].party].push(index);
    }


    function calcTraded(bytes32 _ref, address _party, bool currencyTraded) private returns(uint256){
        uint256 volume;
        ITrade.trade memory tradeReport;
        // Initialize the heap
        Heap heap = new Heap();
        // Push all the trade timestamps onto the heap
        for (uint256 i = 0; i < _trades[_party].length; i++) {
            heap.push(_trades[_party][i]);
        }
        // Pop the minimum timestamp off the heap and process the trade
        while (heap.peek() != 0) {
            uint256 oIndex = heap.pop();
            tradeReport = _tradeRefs[_party][oIndex];
            if (tradeReport.partyRef == _ref) {
                uint256 amount = currencyTraded ? tradeReport.counterpartyInAmount : tradeReport.partyInAmount;
                volume = Math.add(volume, amount);
            }
            delete _tradeRefs[_party][oIndex];
        }
        // Clear the trades array
        delete _trades[_party];
        return volume;
    }


    function getOrder(bytes32 _ref) external view returns(IOrder.order memory){
        require(msg.sender==owner() || msg.sender==_orders[_ref].party, "Unauthorized access to orders");
        return _orders[_ref];
    }

    function getTrade(address _party, uint256 _timestamp) external view returns(ITrade.trade memory){
        require(msg.sender==owner() || msg.sender==_party, "Unauthorized access to trades");
        return _tradeRefs[_party][_timestamp];
    }

    function getTrades() external view returns(uint256[] memory){
        return _trades[msg.sender];
    }

    function removeTrade(address _party, uint256 _timestamp) public onlyOwner {
        // Create a new heap instance
        Heap heap = new Heap();
        // Iterate through the trades array and push the trade timestamps onto the heap
        for (uint256 i = 0; i < _trades[_party].length; i++) {
            heap.push(_trades[_party][i]);
        }
        // Pop the timestamps off the heap one by one, checking if they match the target timestamp
        // If they do not match, add them back to the trades array
        for (uint256 i = 0; i < heap.nodes.length; i++) {
            uint256 tradeTimestamp = heap.pop();
            if (tradeTimestamp != _timestamp) {
                _trades[_party].push(tradeTimestamp);
            }
        }
    }


    function revertTrade(
        bytes32 _orderRef,
        uint256 _qty,
        Order _order,
        uint256 executionDate
    ) onlyOwner external override {
        require(_order == Order.Buy || _order == Order.Sell);
        _orders[_orderRef].qty = _orders[_orderRef].qty + _qty;
        _orders[_orderRef].status = OrderStatus.Open;
        //push to order book
        if (_orders[_orderRef].otype == IOrder.OrderType.Limit) {
            _orderIndex[_orderRef] = _orderbook["Limit"].length;
            _orderbook["Limit"].push(_orderRef);
            checkLimitOrders(_orderRef, IOrder.OrderType.Limit);
        } else if (_orders[_orderRef].otype == IOrder.OrderType.Stop) {
            bytes32[] memory a;
            _orderIndex[_orderRef] = _orderbook["Stop"].length;
            _orderbook["Stop"].push(_orderRef);
            checkStopOrders(_orderRef, IOrder.OrderType.Stop, 0, a);
        }
        //reverse trade
        uint256 oIndex = executionDate + 1;
        ITrade.trade memory tradeToRevert = _tradeRefs[_orders[_orderRef].party][executionDate];
        bytes32 _ref = tradeToRevert.partyRef==_orderRef ? tradeToRevert.counterpartyRef : _orderRef;
        bytes32 _cref = tradeToRevert.counterpartyRef==_orderRef ? _orderRef : tradeToRevert.counterpartyRef;
        ITrade.trade memory tradeToReport = ITrade.trade({
        partyRef: _ref,
        partyInAmount: tradeToRevert.partyRef==_orderRef ? tradeToRevert.counterpartyInAmount : tradeToRevert.partyInAmount,
        partyAddress: _orders[_ref].party,
        counterpartyRef: _cref,
        counterpartyInAmount: tradeToRevert.counterpartyRef==_orderRef ? tradeToRevert.partyInAmount : tradeToRevert.counterpartyInAmount,
        price: tradeToRevert.price,
        dt: oIndex
        });

        // Add reversed trade to heap and mapping for both parties
        _heaps[_orders[_orderRef].party].push(oIndex);
        _tradeRefs[_orders[_orderRef].party][oIndex] = tradeToReport;
        _heaps[_orders[_cref].party].push(oIndex);
        _tradeRefs[_orders[_cref].party][oIndex] = tradeToReport;
    }


    function orderFilled(bytes32 partyRef, bytes32 counterpartyRef, uint256 executionDate) onlyOwner external override {
        delete _orders[partyRef];
        delete _orders[counterpartyRef];

        // Remove trade from heap and mapping for both parties
        uint index = _tradeRefs[_orders[partyRef].party][executionDate];
        _heaps[_orders[partyRef].party].remove(index);
        delete _tradeRefs[_orders[partyRef].party][executionDate];

        index = _tradeRefs[_orders[counterpartyRef].party][executionDate];
        _heaps[_orders[counterpartyRef].party].remove(index);
        delete _tradeRefs[_orders[counterpartyRef].party][executionDate];
    }


}