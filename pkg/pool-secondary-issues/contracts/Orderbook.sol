// Implementation of order book for secondary issues of security tokens that support multiple order types
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IOrder.sol";
import "./interfaces/ITrade.sol";
import "./interfaces/ISecondaryIssuePool.sol";

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

    //mapping users to order references
    mapping(address => bytes32[]) private _userOrderRefs;

    //mapping user's order reference to positions
    mapping(bytes32 => uint256) private _userOrderIndex;

    //order book
    mapping(bytes32 => bytes32[]) private _orderbook;

    mapping(bytes32 => uint256) private _orderIndex;

    //order references from party to order timestamp
    mapping(address => mapping(uint256 => ITrade.trade)) private _tradeRefs;

    //mapping parties to trade time stamps
    mapping(address => uint256[]) private _trades;

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
        IOrder.Order _order,
        uint256[] memory _balances,
        uint256 _currencyIndex,
        uint256 _securityIndex
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
            currencyBalance: _balances[_currencyIndex],  
            securityBalance: _balances[_securityIndex],
            ref: ref
        });
        _orders[ref] = nOrder;
        //fill up indexes
        _userOrderIndex[ref] = _userOrderRefs[_request.from].length;
        _userOrderRefs[_request.from].push(ref);
        if (_params.trade == IOrder.OrderType.Market) {
            return matchOrders(nOrder, IOrder.OrderType.Market);
        } else if (_params.trade == IOrder.OrderType.Limit) {
            _orderIndex[ref] = _orderbook["Limit"].length;
            _orderbook["Limit"].push(ref);
            return matchOrders(nOrder, IOrder.OrderType.Limit);
        } else if (_params.trade == IOrder.OrderType.Stop) {
            _orderIndex[ref] = _orderbook["Stop"].length;
            _orderbook["Stop"].push(ref);
            return matchOrders(nOrder, IOrder.OrderType.Stop);
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
        require (_orders[ref].otype != IOrder.OrderType.Market, "Market order can not be changed");
        require(_orders[ref].status == IOrder.OrderStatus.Open, "Order is already filled");
        require(_orders[ref].party == msg.sender, "Sender is not order creator");
        _orders[ref].price = _price;
        _orders[ref].qty = _qty;
        if (_orders[ref].otype == IOrder.OrderType.Limit) {
            checkLimitOrders(ref, IOrder.OrderType.Limit);
        } else if (_orders[ref].otype == IOrder.OrderType.Stop) {
            checkStopOrders(ref, IOrder.OrderType.Stop);
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
        delete _userOrderRefs[msg.sender][_userOrderIndex[ref]];
        delete _userOrderIndex[ref];
    }

    //check if a buy order in the limit order book can execute over the prevailing (low) price passed to the function
    //check if a sell order in the limit order book can execute under the prevailing (high) price passed to the function
    function checkLimitOrders(bytes32 _ref, IOrder.OrderType _trade) private view returns (uint256, bytes32[] memory){
        uint256 volume;
        bytes32[] memory _marketOrders = new bytes32[](_orderbook["Limit"].length);
        uint256 index;
        for (uint256 i = 0; i < _orderbook["Limit"].length; i++) {
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
    function checkStopOrders(bytes32 _ref, IOrder.OrderType _trade) private view returns (uint256, bytes32[] memory){
        uint256 volume;
        bytes32[] memory _marketOrders = new bytes32[](_orderbook["Stop"].length);
        uint256 index;
        for (uint256 i = 0; i < _orderbook["Stop"].length; i++) {
            if(_orderbook["Stop"][i] == 0) continue;
            if ((_orders[_orderbook["Stop"][i]].order == IOrder.Order.Buy && _orders[_ref].order == IOrder.Order.Sell && (_orders[_orderbook["Stop"][i]].price <= _orders[_ref].price || _orders[_ref].price==0)) ||
                (_orders[_orderbook["Stop"][i]].order == IOrder.Order.Sell && _orders[_ref].order == IOrder.Order.Buy && (_orders[_orderbook["Stop"][i]].price >= _orders[_ref].price || _orders[_ref].price==0))){
                _marketOrders[index] = _orderbook["Stop"][i];
                volume = Math.add(volume, _orders[_orderbook["Stop"][i]].price.mulDown(_orders[_orderbook["Stop"][i]].qty));
                if(_trade!=IOrder.OrderType.Market && _trade!=IOrder.OrderType.Limit && _orderbook["Stop"][i]!=_ref){
                    //only if the consecutive order is a stop loss order, it goes to the market order book
                    _marketOrders[index+1] = _ref;
                }   
                index++;        
            } 
        }
        return (volume, _marketOrders);
    }

    function reorder(uint256 position, IOrder.OrderType list) private {
        if (list == IOrder.OrderType.Limit) {
            for (uint256 i = position; i < _orderbook["Limit"].length; i++) {
                if (i == _orderbook["Limit"].length - 1) {
                    delete _orderbook["Limit"][position];
                }
                else _orderbook["Limit"][position] = _orderbook["Limit"][position + 1];
            }
        } else if (list == IOrder.OrderType.Stop) {
            for (uint256 i = position; i < _orderbook["Stop"].length; i++) {
                if (i == _orderbook["Stop"].length - 1) {
                    delete _orderbook["Stop"][position];
                }
                else _orderbook["Stop"][position] = _orderbook["Stop"][position + 1];
            }
        }
    }

    //match market orders. Sellers get the best price (highest bid) they can sell at.
    //Buyers get the best price (lowest offer) they can buy at.
    function matchOrders(IOrder.order memory _order, IOrder.OrderType _trade) private returns (uint256){
        bytes32 bestBid;
        uint256 bestPrice = 0;
        bytes32 bestOffer;
        bytes32[] memory _marketOrders = new bytes32[](Math.add(_orderbook["Limit"].length, _orderbook["Stop"].length));
        uint256 bidIndex = 0;   
        uint256 securityTraded;
        uint256 currencyTraded;
        uint256 i;

        //check if enough market volume exist to fulfil market orders, or if market depth is zero
        (i, _marketOrders) = checkLimitOrders(_order.ref, _trade);
        // i = Math.add(i, checkStopOrders(_order.ref, _trade));
        if(_trade==IOrder.OrderType.Market){
            if(i < _order.qty)
                return 0;
        }
        else if(_trade==IOrder.OrderType.Limit || _trade==IOrder.OrderType.Stop){
            if(i==0)
                return 0;
        }
        //if market depth exists, then fill order at one or more price points in the order book
        for(i=0; i<_marketOrders.length; i++){
            if (
                _marketOrders[i] != _order.ref && //orders can not be matched with themselves
                _orders[_marketOrders[i]].party != _order.party && //orders posted by a party can not be matched by a counter offer by the same party
                _orders[_marketOrders[i]].status != IOrder.OrderStatus.Filled //orders that are filled can not be matched /traded again
            ) {
                if (_orders[_marketOrders[i]].price == 0 && _order.price == 0) continue; // Case: If Both CP & Party place Order@CMP
                if (_orders[_marketOrders[i]].order == IOrder.Order.Buy && _order.order == IOrder.Order.Sell) {
                    if (_orders[_marketOrders[i]].price >= _order.price || _order.price == 0) {
                        bestPrice = _orders[_marketOrders[i]].price;  
                        bestBid = _marketOrders[i];
                        bidIndex = i;
                    }
                } else if (_orders[_marketOrders[i]].order == IOrder.Order.Sell && _order.order == IOrder.Order.Buy) {
                    // _order.price == 0 condition check for Market Order with 0 Price
                    if (_orders[_marketOrders[i]].price <= _order.price || _order.price == 0) {
                        bestPrice = _orders[_marketOrders[i]].price;  
                        bestOffer = _marketOrders[i];
                        bidIndex = i;
                    }
                }
            }
            if (_order.order == IOrder.Order.Sell) {             
                if (bestBid != "") {
                    if(_order.tokenIn==_security && _order.swapKind==IVault.SwapKind.GIVEN_IN && _order.securityBalance>=_order.qty){
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
                            _order.qty = 0;
                            _orders[bestBid].status = IOrder.OrderStatus.PartlyFilled;
                            _order.status = IOrder.OrderStatus.Filled;  
                            reportTrade(_order.ref, bestBid, bestPrice, securityTraded, currencyTraded);
                            reorder(0, _trade); //order ref is removed from market order list as its qty becomes zero
                            if(_order.otype == IOrder.OrderType.Market)
                                return calcTraded(_order.ref, _order.party, true);
                        }    
                        else if(securityTraded!=0){
                            currencyTraded = securityTraded.mulDown(bestPrice);
                            _order.qty = Math.sub(_order.qty, securityTraded);
                            _orders[bestBid].qty = 0;
                            _orders[bestBid].status = IOrder.OrderStatus.Filled;
                            _order.status = IOrder.OrderStatus.PartlyFilled;
                            reportTrade(_order.ref, bestBid, bestPrice, securityTraded, currencyTraded);
                            reorder(bidIndex, _orders[_marketOrders[bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                        }
                    }
                    else if(_order.tokenOut==_currency && _order.swapKind==IVault.SwapKind.GIVEN_OUT){
                        if(_orders[bestBid].tokenOut==_security && _orders[bestBid].swapKind==IVault.SwapKind.GIVEN_OUT){
                            currencyTraded = _orders[bestBid].qty.mulDown(bestPrice); // calculating amount of currency that needs to be sent in to buy security (tokenOut)
                        }else if(_orders[bestBid].tokenIn==_currency && _orders[bestBid].swapKind==IVault.SwapKind.GIVEN_IN){
                            currencyTraded = _orders[bestBid].qty; // amount of currency sent in (tokenIn) is already there
                        }
                        if(currencyTraded >= _order.qty){
                            currencyTraded = _order.qty;
                            securityTraded = _order.qty.divDown(bestPrice);
                            _orders[bestBid].qty = _orders[bestBid].tokenOut ==_security &&  _orders[bestBid].swapKind == IVault.SwapKind.GIVEN_IN ? 
                                                    Math.sub(_orders[bestBid].qty, _order.qty) : Math.sub(_orders[bestBid].qty, securityTraded);
                            _order.qty = 0;
                            _orders[bestBid].status = IOrder.OrderStatus.PartlyFilled;
                            _order.status = IOrder.OrderStatus.Filled;  
                            reportTrade(_order.ref, bestBid, bestPrice, securityTraded, currencyTraded);
                            reorder(0, _trade); //order ref is removed from market order list as its qty becomes zero
                            if(_order.otype == IOrder.OrderType.Market)
                                return calcTraded(_order.ref, _order.party, false);
                        }    
                        else if(currencyTraded!=0){
                            securityTraded = currencyTraded.divDown(bestPrice);
                            _order.qty = Math.sub(_order.qty, currencyTraded);
                            _orders[bestBid].qty = 0;
                            _orders[bestBid].status = IOrder.OrderStatus.Filled;
                            _order.status = IOrder.OrderStatus.PartlyFilled;   
                            reportTrade(_order.ref, bestBid, bestPrice, securityTraded, currencyTraded);                     
                            reorder(bidIndex, _orders[_marketOrders[bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                        }
                    }
                }
            } 
            else if (_order.order == IOrder.Order.Buy){            
                if (bestOffer != "") {
                    if(_order.tokenIn==_currency && _order.swapKind==IVault.SwapKind.GIVEN_IN && _order.currencyBalance>=_order.qty){
                        if(_orders[bestOffer].tokenIn==_security && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_IN){
                            currencyTraded = _orders[bestOffer].qty.mulDown(bestPrice); // calculating amount of currency that can taken out    
                        } else if (_orders[bestOffer].tokenOut==_currency && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_OUT){
                            currencyTraded = _orders[bestOffer].qty; // amount of currency to take out (tokenOut) is already there 
                        }
                        if(currencyTraded >= _order.qty){
                            currencyTraded = _order.qty;
                            securityTraded = _order.qty.divDown(bestPrice);
                            _orders[bestOffer].qty = _orders[bestOffer].tokenOut ==_currency &&  _orders[bestOffer].swapKind == IVault.SwapKind.GIVEN_OUT ? 
                                                    Math.sub(_orders[bestOffer].qty, _order.qty) : Math.sub(_orders[bestOffer].qty, securityTraded);
                            _order.qty = 0;
                            _orders[bestOffer].status = IOrder.OrderStatus.PartlyFilled;
                            _order.status = IOrder.OrderStatus.Filled;  
                            reportTrade(_order.ref, bestOffer, bestPrice, securityTraded, currencyTraded);
                            reorder(0, _trade); //order ref is removed from market order list as its qty becomes zero
                            if(_order.otype == IOrder.OrderType.Market)
                                return calcTraded(_order.ref, _order.party, true);
                        }    
                        else if(currencyTraded!=0){
                            securityTraded = currencyTraded.divDown(bestPrice);
                            _order.qty = Math.sub(_order.qty, currencyTraded);
                            _orders[bestOffer].qty = 0;
                            _orders[bestOffer].status = IOrder.OrderStatus.Filled;
                            _order.status = IOrder.OrderStatus.PartlyFilled;    
                            reportTrade(_order.ref, bestOffer, bestPrice, securityTraded, currencyTraded);                    
                            reorder(bidIndex, _orders[_marketOrders[bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                        }                    
                    }
                    else if(_order.tokenOut==_security && _order.swapKind==IVault.SwapKind.GIVEN_OUT){
                        if(_orders[bestOffer].tokenOut==_currency && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_OUT){
                            securityTraded = _orders[bestOffer].qty.divDown(bestPrice); // calculating amount of security that needs to be sent in to take out currency (tokenOut)
                        } else if(_orders[bestOffer].tokenIn==_security && _orders[bestOffer].swapKind==IVault.SwapKind.GIVEN_IN){
                            securityTraded = _orders[bestOffer].qty; // amount of security sent in (tokenIn) is already there
                        }
                        if(securityTraded >= _order.qty){
                            securityTraded = _order.qty;
                            currencyTraded = _order.qty.mulDown(bestPrice);
                            _orders[bestOffer].qty = _orders[bestOffer].tokenIn ==_security && _orders[bestOffer].swapKind == IVault.SwapKind.GIVEN_IN ? 
                                                    Math.sub(_orders[bestOffer].qty, _order.qty) : Math.sub(_orders[bestOffer].qty, currencyTraded);
                            _order.qty = 0;
                            _orders[bestOffer].status = IOrder.OrderStatus.PartlyFilled;
                            _order.status = IOrder.OrderStatus.Filled;  
                            reportTrade(_order.ref, bestOffer, bestPrice, securityTraded, currencyTraded);
                            reorder(0, _trade); //order ref is removed from market order list as its qty becomes zero
                            if(_order.otype == IOrder.OrderType.Market)
                                return calcTraded(_order.ref, _order.party, false);   
                        }    
                        else if(securityTraded!=0){
                            currencyTraded = securityTraded.mulDown(bestPrice);
                            _order.qty = Math.sub(_order.qty, securityTraded);
                            _orders[bestOffer].qty = 0;
                            _orders[bestOffer].status = IOrder.OrderStatus.Filled;
                            _order.status = IOrder.OrderStatus.PartlyFilled;
                            reportTrade(_order.ref, bestOffer, bestPrice, securityTraded, currencyTraded);
                            reorder(bidIndex, _orders[_marketOrders[bidIndex]].otype); //bid order ref is removed from market order list as its qty becomes zero
                        }
                    }                
                }
            }
        }
        //delete _marketOrders;
    }

    function reportTrade(bytes32 _ref, bytes32 _cref, uint256 _price, uint256 securityTraded, uint256 currencyTraded) private {
        _previousTs = _previousTs + 1;
        uint256 oIndex = _previousTs;
        ITrade.trade memory tradeToReport = ITrade.trade({
            partyRef: _ref,
            partySwapIn: _orders[_ref].swapKind==IVault.SwapKind.GIVEN_IN ? true : false,
            partyTokenIn: _orders[_ref].tokenIn==_security ? "security" : "currency",
            partyInAmount: _orders[_ref].tokenIn==_security ? securityTraded : currencyTraded,
            party: _orders[_ref].party,
            counterpartyRef: _cref, 
            counterpartySwapIn: _orders[_cref].swapKind==IVault.SwapKind.GIVEN_IN ? true : false,
            counterpartyTokenIn: _orders[_cref].tokenIn==_security ? "security" : "currency",
            counterpartyInAmount: _orders[_cref].tokenIn==_security ? securityTraded : currencyTraded,
            counterparty: _orders[_cref].party, 
            security: _security,
            currency: _currency,
            price: _price,
            otype: _orders[_ref].otype,
            dt: oIndex
        });                 
        _tradeRefs[_orders[_ref].party][oIndex] = tradeToReport;
        _tradeRefs[_orders[_cref].party][oIndex] = tradeToReport;        
        _trades[_orders[_ref].party].push(oIndex);
        _trades[_orders[_cref].party].push(oIndex);
    }

    function calcTraded(bytes32 _ref, address _party, bool currencyTraded) private returns(uint256){
        uint256 oIndex;
        uint256 volume;
        ITrade.trade memory tradeReport;
        for(uint256 i=0; i<_trades[_party].length; i++){
            oIndex = _trades[_party][i];
            tradeReport = _tradeRefs[_party][oIndex];
            if(tradeReport.partyRef==_ref){
                uint256 amount = currencyTraded ? tradeReport.counterpartyInAmount : tradeReport.partyInAmount;
                volume = Math.add(volume, amount);
            }
            delete _trades[_party][i];
            delete _tradeRefs[_party][oIndex];
        }
        return volume; 
    }   

    function getTrade(address _party, uint256 _timestamp) public view returns(ITrade.trade memory){
        require(msg.sender==owner() || msg.sender==_party, "Unauthorized access to trades");
        return _tradeRefs[_party][_timestamp];
    }

    function getTrades() public view returns(uint256[] memory){
        return _trades[msg.sender];
    }

    function removeTrade(address _party, uint256 _timestamp) public onlyOwner {
        for(uint256 i=0; i<_trades[_party].length; i++){
            if(_trades[_party][i]==_timestamp)
                delete _trades[_party][i];
        }
    }

    function revertTrade(
        bytes32 _orderRef,
        uint256 _qty,
        Order _order
    ) onlyOwner external override {
        require(_order == Order.Buy || _order == Order.Sell);
        _orders[_orderRef].qty = _orders[_orderRef].qty + _qty;
        _orders[_orderRef].status = OrderStatus.Open;
        //push to order book
        if (_orders[_orderRef].otype == IOrder.OrderType.Market) {
            //matchOrders(_orderRef, IOrder.OrderType.Market);
        } else if (_orders[_orderRef].otype == IOrder.OrderType.Limit) {
            _orderIndex[_orderRef] = _orderbook["Limit"].length;
            _orderbook["Limit"].push(_orderRef);
            checkLimitOrders(_orderRef, IOrder.OrderType.Limit);
        } else if (_orders[_orderRef].otype == IOrder.OrderType.Stop) {
            _orderIndex[_orderRef] = _orderbook["Stop"].length;
            _orderbook["Stop"].push(_orderRef);
            checkStopOrders(_orderRef, IOrder.OrderType.Stop);
        }
    }

    function orderFilled(bytes32 partyRef, bytes32 counterpartyRef) onlyOwner external override {
        delete _userOrderRefs[_orders[partyRef].party][_userOrderIndex[partyRef]];
        delete _userOrderIndex[partyRef];
        delete _orders[partyRef];
        delete _userOrderRefs[_orders[counterpartyRef].party][_userOrderIndex[counterpartyRef]];
        delete _userOrderIndex[counterpartyRef];
        delete _orders[counterpartyRef];
    }

    function tradeSettled(
        bytes32 partyRef,
        bytes32 counterpartyRef
    ) onlyOwner external override {
        _orders[partyRef].status = OrderStatus.Filled;
        _orders[counterpartyRef].status = OrderStatus.Filled;
    }

}