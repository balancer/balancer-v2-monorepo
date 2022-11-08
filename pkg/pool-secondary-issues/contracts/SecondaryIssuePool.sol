// Implementation of pool for secondary issues of security tokens that support multiple order types
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IOrder.sol";
import "./interfaces/ITrade.sol";
import "./interfaces/ISettlor.sol";

import "./utilities/StringUtils.sol";

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IGeneralPool.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";


contract SecondaryIssuePool is BasePool, IGeneralPool, IOrder, ITrade {
    using Math for uint256;
    using FixedPoint for uint256;
    using StringUtils for *;

    address private immutable _security;
    address private immutable _currency;

    uint256 private constant _TOTAL_TOKENS = 3; //Security token, Currency token (ie, paired token), Balancer pool token

    uint256 private constant _INITIAL_BPT_SUPPLY = 2**(112) - 1;

    uint256 private _MAX_TOKEN_BALANCE;

    uint256 private immutable _bptIndex;
    uint256 private immutable _securityIndex;
    uint256 private immutable _currencyIndex;

    address payable private balancerManager;

    struct Params {
        OrderType trade;
        uint256 price;
    }

    //counter for block timestamp nonce for creating unique order references
    uint256 private previousTs = 0;

    //order references
    bytes32[] private orderRefs;

    //mapping order reference to order
    mapping(bytes32 => IOrder.order) private orders;

    //mapping order reference to position
    mapping(bytes32 => uint256) private orderIndex;

    //mapping users to order references
    mapping(address => bytes32[]) private userOrderRefs;

    //mapping user's order reference to positions
    mapping(bytes32 => uint256) private userOrderIndex;

    //mapping market order no to order reference
    mapping(uint256 => bytes32) private marketOrders;

    //size of market order book
    uint256 marketOrderbook;

    //mapping limit order no to order reference
    mapping(uint256 => bytes32) private limitOrders;

    //mapping of limit to market order
    mapping(uint256 => uint256) private limitMarket;

    //size of limit order book
    uint256 limitOrderbook;

    //mapping stop order no to order reference
    mapping(uint256 => bytes32) private stopOrders;

    //mapping of stop to market order
    mapping(uint256 => uint256) private stopMarket;

    //size of stop loss order book
    uint256 stopOrderbook;

    //order matching related
    bytes32 private bestBid;
    uint256 private bestBidPrice = 0;
    bytes32 private bestOffer;
    uint256 private bestOfferPrice = 0;
    uint256 private bidIndex = 0;
    uint256 private bestUnfilledBid;
    uint256 private bestUnfilledOffer;

    //mapping a trade reference to trade details
    mapping(bytes32 => ITrade.trade) private trades;

    //mapping order ref to trade reference
    mapping(bytes32 => bytes32) private tradeRefs;

    event TradeReport(
        address indexed security,
        address party,
        address counterparty,
        uint256 price,
        uint256 askprice,
        address currency,
        uint256 amount,
        bytes32 status,
        uint256 executionDate
    );

    event BestAvailableTrades(uint256 bestUnfilledBid, uint256 bestUnfilledOffer);

    event Offer(address indexed security, uint256 secondaryOffer);

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        address security,
        address currency,
        uint256 maxSecurityOffered,
        uint256 tradeFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            name,
            symbol,
            _sortTokens(IERC20(security), IERC20(currency), IERC20(this)),
            new address[](_TOTAL_TOKENS),
            tradeFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // set tokens
        _security = security;
        _currency = currency;

        // Set token indexes
        (uint256 securityIndex, uint256 currencyIndex, uint256 bptIndex) = _getSortedTokenIndexes(
            IERC20(security),
            IERC20(currency),
            IERC20(this)
        );
        _bptIndex = bptIndex;
        _securityIndex = securityIndex;
        _currencyIndex = currencyIndex;

        // set max total balance of securities
        _MAX_TOKEN_BALANCE = maxSecurityOffered;

        balancerManager = payable(owner);
    }

    function getSecurity() external view returns (address) {
        return _security;
    }

    function getCurrency() external view returns (address) {
        return _currency;
    }

    function getSecurityOffered() external view returns (uint256) {
        return _MAX_TOKEN_BALANCE;
    }

    function initialize() external {
        bytes32 poolId = getPoolId();
        IVault vault = getVault();
        (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);

        uint256[] memory _maxAmountsIn = new uint256[](_TOTAL_TOKENS);
        _maxAmountsIn[_bptIndex] = _INITIAL_BPT_SUPPLY;

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: _maxAmountsIn,
            userData: "",
            fromInternalBalance: false
        });
        vault.joinPool(getPoolId(), address(this), address(this), request);
        emit Offer(_security, _MAX_TOKEN_BALANCE);
    }

    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public override onlyVault(request.poolId) whenNotPaused returns (uint256) {
        uint256[] memory scalingFactors = _scalingFactors();
        
        uint256 tradeType_length = string(request.userData).substring(0,1).stringToUint();
        bytes32 otype = string(request.userData).substring(1, tradeType_length + 1).stringToBytes32();

        Params memory params = Params({
            trade: otype=="Market" ? OrderType.Market:(otype=="Limit" ? OrderType.Limit : OrderType.Stop),
            price: string(request.userData).substring(tradeType_length, request.userData.length).stringToUint()
        });

        uint256 amount = 0;
        uint256 price = 0;

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            request.amount = _upscale(request.amount, scalingFactors[indexIn]);
            if (request.tokenOut == IERC20(_currency)) {
                (price, amount) = newOrder(request, params, Order.Sell, balances);
                if (params.trade == OrderType.Market) 
                return _downscaleDown(price, scalingFactors[indexOut]);
            } 
            else if (request.tokenOut == IERC20(_security)) {
                uint256 postPaidCurrencyBalance = Math.add(balances[_currencyIndex], request.amount);
                request.amount = Math.div(postPaidCurrencyBalance, balances[_securityIndex], false);
                (price, amount) = newOrder(request, params, Order.Buy, balances);
                if (params.trade == OrderType.Market) 
                return _downscaleDown(amount, scalingFactors[indexOut]);
            }
        } 
        else if (request.kind == IVault.SwapKind.GIVEN_OUT) {
            request.amount = _upscale(request.amount, scalingFactors[indexOut]);
            if (request.tokenIn == IERC20(_currency)) {
                uint256 postPaidCurrencyBalance = Math.add(balances[_currencyIndex], request.amount);
                request.amount = Math.div(postPaidCurrencyBalance, balances[_securityIndex], false);
                (price, amount) = newOrder(request, params, Order.Buy, balances);
                if (params.trade == OrderType.Market) 
                return _downscaleDown(amount, scalingFactors[indexOut]);
            } else if (request.tokenIn == IERC20(_security)) {
                (price, amount) = newOrder(request, params, Order.Sell, balances);
                if (params.trade == OrderType.Market) 
                return _downscaleDown(price, scalingFactors[indexOut]);
            }
        }
    }

    function _onInitializePool(
        bytes32,
        address sender,
        address recipient,
        uint256[] memory,
        bytes memory
    ) internal view override whenNotPaused returns (uint256, uint256[] memory) {
        //on initialization, pool simply premints max BPT supply possible
        _require(sender == address(this), Errors.INVALID_INITIALIZATION);
        _require(recipient == address(this), Errors.INVALID_INITIALIZATION);

        uint256 bptAmountOut = _INITIAL_BPT_SUPPLY;

        uint256[] memory amountsIn = new uint256[](_TOTAL_TOKENS);
        amountsIn[_bptIndex] = _INITIAL_BPT_SUPPLY;

        return (bptAmountOut, amountsIn);
    }

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        //joins are not supported as this pool supports an order book only
        _revert(Errors.UNHANDLED_BY_SECONDARY_POOL);
    }

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        //exits are not required now, but we perhaps need to provide an emergency pause mechanism that returns tokens to order takers and makers
        _revert(Errors.UNHANDLED_BY_SECONDARY_POOL);
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        if (token == IERC20(_security) || token == IERC20(_currency) || token == IERC20(this)) {
            return FixedPoint.ONE;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](_TOTAL_TOKENS);
        scalingFactors[_securityIndex] = FixedPoint.ONE;
        scalingFactors[_currencyIndex] = FixedPoint.ONE;
        scalingFactors[_bptIndex] = FixedPoint.ONE;
        return scalingFactors;
    }

    function newOrder(
        SwapRequest memory _request,
        Params memory _params,
        Order _order,
        uint256[] memory _balances
    ) private returns (uint256, uint256) {
        require(_params.trade == OrderType.Market || _params.trade == OrderType.Limit || _params.trade == OrderType.Stop);
        require(_order == Order.Buy || _order == Order.Sell);
        if(block.timestamp == previousTs)
            previousTs = previousTs + 1;
        else
            previousTs = block.timestamp;
        bytes32 ref = keccak256(abi.encodePacked(_request.from, previousTs));
        //fill up order details
        IOrder.order memory nOrder = IOrder.order({
            orderno: orderRefs.length,
            otype: _params.trade,
            order: _order,
            status: OrderStatus.Open,
            qty: _request.amount,
            dt: previousTs,
            party: _request.from,
            price: _params.price,  
            currencyBalance: _balances[_currencyIndex],  
            securityBalance: _balances[_securityIndex]  
        });
        orders[ref] = nOrder;
        //fill up indexes
        orderIndex[ref] = orderRefs.length;
        orderRefs.push(ref);
        userOrderIndex[ref] = userOrderRefs[_request.from].length;
        userOrderRefs[_request.from].push(ref);
        if (_params.trade == OrderType.Market) {
            orders[ref].status = OrderStatus.Open;
            marketOrders[orders[ref].orderno] = ref;
            marketOrderbook = marketOrderbook + 1;
            return matchOrders(ref, OrderType.Market);
        } else if (_params.trade == OrderType.Limit) {
            orders[ref].status = OrderStatus.Open;
            limitOrders[orders[ref].orderno] = ref;
            limitOrderbook = limitOrderbook + 1;
            checkLimitOrders(_params.price);
        } else if (_params.trade == OrderType.Stop) {
            orders[ref].status = OrderStatus.Open;
            stopOrders[orders[ref].orderno] = ref;
            stopOrderbook = stopOrderbook + 1;
            checkStopOrders(_params.price);
        }
        return(0,0);
    }

    function getOrderRef() external view override returns (bytes32[] memory) {
        return userOrderRefs[msg.sender];
    }

    function editOrder(
        bytes32 ref,
        uint256 _price,
        uint256 _qty
    ) external override {
        require(orders[ref].status == OrderStatus.Open, "Order is already filled");
        require(orders[ref].party == msg.sender, "Sender is not order creator"); 
        orders[ref].price = _price;
        orders[ref].qty = _qty;
        orders[ref].dt = block.timestamp;
        if (orders[ref].otype == OrderType.Limit) {
            limitOrders[orders[ref].orderno] = ref;
            checkLimitOrders(_price);
        } else if (orders[ref].otype == OrderType.Stop) {
            stopOrders[orders[ref].orderno] = ref;
            checkStopOrders(_price);
        }        
    }

    function cancelOrder(bytes32 ref) external override {
        require(orders[ref].party == msg.sender);
        delete marketOrders[orders[ref].orderno];
        delete limitMarket[orders[ref].orderno];
        delete limitOrders[orders[ref].orderno];
        delete stopMarket[orders[ref].orderno];
        delete stopOrders[orders[ref].orderno];
        delete orders[ref];
        delete orderRefs[orderIndex[ref]];
        delete orderIndex[ref];
        delete userOrderRefs[msg.sender][userOrderIndex[ref]];
        delete userOrderIndex[ref];
    }

    //check if a buy order in the limit order book can execute over the prevailing (low) price passed to the function
    //check if a sell order in the limit order book can execute under the prevailing (high) price passed to the function
    function checkLimitOrders(uint256 _priceFilled) private {
        bytes32 ref;
        for (uint256 i = 0; i < limitOrderbook; i++) {
            if ((orders[limitOrders[i]].order == Order.Buy && orders[limitOrders[i]].price >= _priceFilled) ||
                (orders[limitOrders[i]].order == Order.Sell && orders[limitOrders[i]].price <= _priceFilled)){
                marketOrders[orders[limitOrders[i]].orderno] = limitOrders[i];
                marketOrderbook = marketOrderbook + 1;
                ref = limitOrders[i];
                reorder(i, OrderType.Limit);
                matchOrders(ref, OrderType.Limit);
            } 
        }
    }

    //check if a buy order in the stoploss order book can execute under the prevailing (high) price passed to the function
    //check if a sell order in the stoploss order book can execute over the prevailing (low) price passed to the function
    function checkStopOrders(uint256 _priceFilled) private {
        bytes32 ref;
        for (uint256 i = 0; i < stopOrderbook; i++) {
            if ((orders[stopOrders[i]].order == Order.Buy && orders[stopOrders[i]].price <= _priceFilled) ||
                (orders[stopOrders[i]].order == Order.Sell && orders[stopOrders[i]].price >= _priceFilled)){
                marketOrders[orders[stopOrders[i]].orderno] = stopOrders[i];
                marketOrderbook = marketOrderbook + 1;
                ref = stopOrders[i];
                reorder(i, OrderType.Stop);
                matchOrders(ref, OrderType.Stop);
            } 
        }
    }

    function reorder(uint256 position, OrderType list) private {
        if (list == OrderType.Market) {
            for (uint256 i = position; i < marketOrderbook; i++) {
                if (i == marketOrderbook - 1){ 
                    delete marketOrders[position];
                }
                else marketOrders[position] = marketOrders[position + 1];
            }
            marketOrderbook = marketOrderbook - 1;
        } else if (list == OrderType.Limit) {
            for (uint256 i = position; i < limitOrderbook; i++) {
                if (i == limitOrderbook - 1) {
                    delete limitOrders[position];
                }
                else limitOrders[position] = limitOrders[position + 1];
            }
            limitOrderbook = limitOrderbook - 1;
        } else if (list == OrderType.Stop) {
            for (uint256 i = position; i < stopOrderbook; i++) {
                if (i == stopOrderbook - 1) {
                    delete stopOrders[position];
                }
                else stopOrders[position] = stopOrders[position + 1];
            }
            stopOrderbook = stopOrderbook - 1;
        }
    }

    //match market orders. Sellers get the best price (highest bid) they can sell at.
    //Buyers get the best price (lowest offer) they can buy at.
    function matchOrders(bytes32 _ref, OrderType _trade) private returns (uint256, uint256) {

        for (uint256 i = 0; i < marketOrderbook; i++) {
            if (
                marketOrders[i] != _ref &&
                //orders[marketOrders[i]].party != orders[_ref].party && 
                orders[marketOrders[i]].status != OrderStatus.Filled
            ) {
                
                if (orders[marketOrders[i]].order == Order.Buy && orders[_ref].order == Order.Sell) {
                    if (orders[marketOrders[i]].price >= orders[_ref].price) {
                        if (orders[marketOrders[i]].price > bestBidPrice) {
                            bestUnfilledBid = bestBidPrice;
                            bestBidPrice = orders[marketOrders[i]].price;
                            bestBid = orderRefs[i];
                            bidIndex = i;
                        }
                    }
                } else if (orders[marketOrders[i]].order == Order.Sell && orders[_ref].order == Order.Buy) {
                    if (orders[marketOrders[i]].price <= orders[_ref].price) {
                        if (orders[marketOrders[i]].price < bestOfferPrice || bestOfferPrice == 0) {
                            bestUnfilledOffer = bestOfferPrice;
                            bestOfferPrice = orders[marketOrders[i]].price;
                            bestOffer = orderRefs[i];
                            bidIndex = i;
                        }
                    }
                }
            }
        }
        if (orders[_ref].order == Order.Sell) {
            if (bestBid != "") {
                if (orders[bestBid].qty >= orders[_ref].qty) {
                    orders[bestBid].qty = orders[bestBid].qty - orders[_ref].qty;
                    uint256 qty = orders[_ref].qty;
                    orders[_ref].qty = 0;
                    orders[bestBid].status = OrderStatus.Filled;
                    orders[_ref].status = OrderStatus.Filled;
                    reportTrade(
                        _ref,
                        orders[_ref].party,
                        bestBid,
                        orders[bestBid].party,
                        orders[_ref].price,
                        qty,
                        orders[_ref].order,
                        orders[_ref].otype
                    );
                    reorder(bidIndex, OrderType.Market);
                    if (_trade == OrderType.Market) return (orders[_ref].price, qty);
                } else {
                    orders[_ref].qty = orders[_ref].qty - orders[bestBid].qty;
                    uint256 qty = orders[bestBid].qty;
                    orders[bestBid].qty = 0;
                    orders[bestBid].status = OrderStatus.PartlyFilled;
                    orders[_ref].status = OrderStatus.PartlyFilled;
                    reportTrade(
                        _ref,
                        orders[_ref].party,
                        bestBid,
                        orders[bestBid].party,
                        orders[_ref].price,
                        qty,
                        orders[_ref].order,
                        orders[_ref].otype
                    );
                    if (_trade == OrderType.Market) return (orders[_ref].price, qty);
                }
                emit BestAvailableTrades(bestUnfilledBid, bestUnfilledOffer);
                orders[_ref].securityBalance = Math.sub(orders[_ref].securityBalance, orders[_ref].qty);
                orders[_ref].currencyBalance = Math.add(orders[_ref].currencyBalance, orders[_ref].price);
                checkLimitOrders(orders[_ref].price);
                checkStopOrders(orders[_ref].price);
            }
            return(0,0);
        } else if (orders[_ref].order == Order.Buy) {
            if (bestOffer != "") {
                if (orders[bestOffer].qty >= orders[_ref].qty) {
                    orders[bestOffer].qty = orders[bestOffer].qty - orders[_ref].qty;
                    uint256 qty = orders[_ref].qty;
                    orders[_ref].qty = 0;
                    orders[bestOffer].status = OrderStatus.Filled;
                    orders[_ref].status = OrderStatus.Filled;
                    reportTrade(
                        bestOffer,
                        orders[bestOffer].party,
                        _ref,
                        orders[_ref].party,
                        orders[_ref].price,
                        qty,
                        orders[_ref].order,
                        orders[_ref].otype
                    );
                    reorder(bidIndex, OrderType.Market);
                    if (_trade == OrderType.Market) return (orders[_ref].price, qty);
                } else {
                    orders[_ref].qty = orders[_ref].qty - orders[bestOffer].qty;
                    uint256 qty = orders[bestOffer].qty;
                    orders[bestOffer].qty = 0;
                    orders[bestOffer].status = OrderStatus.PartlyFilled;
                    orders[_ref].status = OrderStatus.PartlyFilled;
                    reportTrade(
                        bestOffer,
                        orders[bestOffer].party,
                        _ref,
                        orders[_ref].party,
                        orders[_ref].price,
                        qty,
                        orders[_ref].order,
                        orders[_ref].otype
                    );
                    if (_trade == OrderType.Market) return (orders[_ref].price, qty);
                }
                emit BestAvailableTrades(bestUnfilledBid, bestUnfilledOffer);
                orders[_ref].securityBalance = Math.add(orders[_ref].securityBalance, orders[_ref].qty);
                orders[_ref].currencyBalance = Math.sub(orders[_ref].currencyBalance, orders[_ref].price);
                checkLimitOrders(orders[_ref].price);
                checkStopOrders(orders[_ref].price);
            }
            return(0,0);
        }
    }

    function reportTrade(
        bytes32 _pregRef,
        address _transferor,
        bytes32 _cpregRef,
        address _transferee,
        uint256 _price,
        uint256 _qty,
        Order _order,
        OrderType _type
    ) private {
        uint256 _askprice = 0;
        if (_order == Order.Buy) {
            _askprice = orders[_pregRef].price;
        } else if (_order == Order.Sell) {
            _askprice = orders[_cpregRef].price;
        }
        bytes32 _tradeRef = keccak256(abi.encodePacked(_pregRef, _cpregRef));
        tradeRefs[_pregRef] = _tradeRef;
        tradeRefs[_cpregRef] = _tradeRef;
        trades[_tradeRef] = ITrade.trade(
            _transferor,
            _transferee,
            _security,
            _price,
            _askprice,
            _currency,
            _order,
            _type,
            _qty,
            block.timestamp
        );
        uint256 _executionDt = block.timestamp;
        emit TradeReport(
            _security,
            _transferor,
            _transferee,
            _price,
            _askprice,
            _currency,
            _qty,
            "Pending",
            _executionDt
        );
        //commenting out Settlement callback below as this needs to be implemented by whoever is connecting the pools to their settlement system
        /*bytes32 _transfereeDPID = ISettlor(balancerManager).getTransferAgent(_transferee);
        bytes32 _transferorDPID = ISettlor(balancerManager).getTransferAgent(_transferor);
        ISettlor.settlement memory tradeToSettle = ISettlor.settlement({
            transferor: _transferor,
            transferee: _transferee,
            security: _security,
            status: "Pending",
            currency: _currency,
            price: _price,
            unitsToTransfer: _qty,
            consideration: Math.mul(_price, _qty),
            executionDate: _executionDt,
            partyRef: _pregRef,
            counterpartyRef: _cpregRef,
            transferorDPID: _transferorDPID,
            transfereeDPID: _transfereeDPID,
            orderPool: address(this)
        });
        ISettlor(balancerManager).postSettlement(tradeToSettle, _tradeRef);*/
    }

    function getTrade(bytes32 ref) external view override returns (uint256 b, uint256 a) {
        uint256 bid = 0;
        uint256 ask = 0;
        if (trades[tradeRefs[ref]].security == _security && trades[tradeRefs[ref]].order == Order.Buy) {
            bid = trades[tradeRefs[ref]].price;
            ask = trades[tradeRefs[ref]].askprice;
        }
        if (trades[tradeRefs[ref]].security == _security && trades[tradeRefs[ref]].order == Order.Sell) {
            ask = trades[tradeRefs[ref]].price;
            bid = trades[tradeRefs[ref]].askprice;
        }
        return (bid, ask);
    }

    function revertTrade(
        bytes32 _orderRef,
        uint256 _qty,
        Order _order
    ) external override {
        require(balancerManager == msg.sender);
        require(_order == Order.Buy || _order == Order.Sell);
        orders[_orderRef].qty = orders[_orderRef].qty + _qty;
        orders[_orderRef].status = OrderStatus.Open;
        orders[_orderRef].orderno = orderRefs.length;
        marketOrders[orders[_orderRef].orderno] = _orderRef;
        marketOrderbook = marketOrderbook + 1;
    }

    function orderFilled(bytes32 partyRef, bytes32 counterpartyRef) external override {
        require(balancerManager == msg.sender);
        delete userOrderRefs[orders[partyRef].party][userOrderIndex[partyRef]];
        delete userOrderIndex[partyRef];
        delete orders[partyRef];
        delete orderRefs[orderIndex[partyRef]];
        delete orderIndex[partyRef];
        delete userOrderRefs[orders[counterpartyRef].party][userOrderIndex[counterpartyRef]];
        delete userOrderIndex[counterpartyRef];
        delete orders[counterpartyRef];
        delete orderRefs[orderIndex[counterpartyRef]];
        delete orderIndex[counterpartyRef];
    }

    function tradeSettled(
        bytes32 tradeRef,
        bytes32 partyRef,
        bytes32 counterpartyRef
    ) external override {
        require(balancerManager == msg.sender);
        delete trades[tradeRef];
        orders[partyRef].status = OrderStatus.Filled;
        orders[counterpartyRef].status = OrderStatus.Filled;
    }

    function _getMinimumBpt() internal pure override returns (uint256) {
        // Secondary Pools don't lock any BPT, as the total supply will already be forever non-zero due to the preminting
        // mechanism, ensuring initialization only occurs once.
        return 0;
    }
}
