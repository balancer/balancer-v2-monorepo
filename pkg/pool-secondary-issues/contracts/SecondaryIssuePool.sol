// Implementation of pool for secondary issues of security tokens that support multiple order types
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IOrder.sol";
import "./interfaces/ITrade.sol";
import "./interfaces/ISettlor.sol";
import "./utilities/StringUtils.sol";
import "./Orderbook.sol";

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-interfaces/contracts/pool-secondary/SecondaryPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IGeneralPool.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

contract SecondaryIssuePool is BasePool, IGeneralPool {
    using SecondaryPoolUserData for bytes;
    using StringUtils for *;
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    Orderbook public _orderbook;
    
    address private immutable _security;
    address private immutable _currency;

    uint256 private constant _TOTAL_TOKENS = 3; //Security token, Currency token (ie, paired token), Balancer pool token

    uint256 private constant _INITIAL_BPT_SUPPLY = 2**(112) - 1;

    uint256 private _MAX_TOKEN_BALANCE;
    uint256 private immutable _swapFee;

    uint256 private immutable _bptIndex;
    uint256 private immutable _securityIndex;
    uint256 private immutable _currencyIndex;

    address payable immutable private _balancerManager;
    
    event TradeReport(
        address indexed security,
        address party,
        address counterparty,
        uint256 price,
        address currency,
        uint256 amount,
        uint256 executionDate
    );

    event OrderBook(address tokenIn, address tokenOut, uint256 amountOffered, uint256 priceOffered);

    event Offer(address indexed security, uint256 secondaryOffer, address currency, address orderBook);    

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

        //swap fee
        _swapFee = tradeFeePercentage;

        _balancerManager = payable(owner);

        _orderbook = new Orderbook(payable(owner), security, currency, address(this));

        emit Offer(security, maxSecurityOffered, currency, address(_orderbook));
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

    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public override onlyVault(request.poolId) whenNotPaused returns (uint256) {
        require (request.kind == IVault.SwapKind.GIVEN_IN || request.kind == IVault.SwapKind.GIVEN_OUT, "Invalid swap");
        require(request.tokenOut == IERC20(_currency) ||
                request.tokenOut == IERC20(_security) ||
                request.tokenIn == IERC20(_currency) ||
                request.tokenIn == IERC20(_security), "Invalid swapped tokens");
        
        uint256[] memory scalingFactors = _scalingFactors();
        IOrder.Params memory params;

        string memory otype;
        uint256 tp;

        if(request.userData.length!=0){
            (otype, tp) = abi.decode(request.userData, (string, uint256)); 
            if(bytes(otype).length==0){                
                ITrade.trade memory tradeToReport = _orderbook.getTrade(request.from, request.amount);
                //ISettlor(_balancerManager).requestSettlement(tradeToReport, _orderbook);
                bytes32 tradedInToken = keccak256(abi.encodePacked(tradeToReport.partyTokenIn));
                bytes32 tokenName = keccak256(abi.encodePacked(request.tokenIn == IERC20(_security) ? "security" : "currency"));
                uint256 amount = tradedInToken==tokenName ? tradeToReport.partyInAmount : tradeToReport.counterpartyInAmount;
                emit TradeReport(
                    tradeToReport.security,
                    tradedInToken=="security" ? tradeToReport.party : tradeToReport.counterparty,
                    tradedInToken=="currency" ? tradeToReport.party : tradeToReport.counterparty,
                    tradeToReport.price,
                    tradeToReport.currency,
                    amount,
                    tradeToReport.dt
                );
                //_orderbook.removeTrade(request.from, request.amount);
                if(request.kind == IVault.SwapKind.GIVEN_IN){
                    if (request.tokenIn == IERC20(_security) || request.tokenIn == IERC20(_currency)) {
                        return _downscaleDown(amount, scalingFactors[indexOut]);
                    }
                }
                else if(request.kind == IVault.SwapKind.GIVEN_OUT) {
                    if (request.tokenOut == IERC20(_security) || request.tokenOut == IERC20(_currency)) {
                        return _downscaleDown(amount, scalingFactors[indexIn]);
                    }
                }
            }
            else{              
                if(tp!=0){ //we have removed market order from this place, any order where price is indicated is a limit or stop loss order
                    params = IOrder.Params({
                        trade: keccak256(abi.encodePacked(otype))==keccak256(abi.encodePacked("Limit")) ? IOrder.OrderType.Limit : IOrder.OrderType.Stop,
                        price: tp 
                    });                    
                }
            }                  
        }else{ //by default, any order without price specified is a market order
            if (request.tokenIn == IERC20(_currency) || request.tokenOut == IERC20(_security)){
                //it is a buy (bid), so need the best offer by a counter party
                params = IOrder.Params({
                    trade: IOrder.OrderType.Market,
                    price: 0
                });
            }
            else {
                //it is a sell (offer), so need the best bid by a counter party
                params = IOrder.Params({
                    trade: IOrder.OrderType.Market,
                    price: 0
                });
            }
        }

        if (request.kind == IVault.SwapKind.GIVEN_IN) 
            request.amount = _upscale(request.amount, scalingFactors[indexIn]);
        else if (request.kind == IVault.SwapKind.GIVEN_OUT)
            request.amount = _upscale(request.amount, scalingFactors[indexOut]);

        emit OrderBook(address(request.tokenIn), address(request.tokenOut), request.amount, params.price);

        if (request.tokenOut == IERC20(_currency) || request.tokenIn == IERC20(_security)) {
            tp = _orderbook.newOrder(request, params, IOrder.Order.Sell, balances, _currencyIndex, _securityIndex);
        } 
        else if (request.tokenOut == IERC20(_security) || request.tokenIn == IERC20(_currency)) {
            tp = _orderbook.newOrder(request, params, IOrder.Order.Buy, balances, _currencyIndex, _securityIndex);
        }
        if(params.trade == IOrder.OrderType.Market){
            require(tp!=0, "Insufficient liquidity");
            return tp;
        }
        
    }

    function _onInitializePool(
        bytes32,
        address sender,
        address recipient,
        uint256[] memory,
        bytes memory userData
    ) internal view override whenNotPaused returns (uint256, uint256[] memory) {
        //on initialization, pool simply premints max BPT supply possible
        address balancerManager = _balancerManager;
        _require(sender == balancerManager, Errors.INVALID_INITIALIZATION);
        _require(recipient == payable(balancerManager), Errors.INVALID_INITIALIZATION);

        uint256 bptAmountOut = _INITIAL_BPT_SUPPLY;
        uint256[] memory amountsIn = userData.joinKind();

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
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory userData
    ) internal view override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        SecondaryPoolUserData.ExitKind kind = userData.exitKind();
        if (kind != SecondaryPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            //usually exit pool reverts
            _revert(Errors.UNHANDLED_BY_SECONDARY_POOL);
        } else {
            (bptAmountIn, amountsOut) = _exit(balances, userData);
        }
    }

    function _exit(uint256[] memory balances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {   
        // This proportional exit function is only enabled if the contract is paused, to provide users a way to
        // retrieve their tokens in case of an emergency.
        uint256 bptAmountIn = userData.exactBptInForTokensOut();
        uint256[] memory amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            // BPT is skipped as those tokens are not the LPs, but rather the preminted and undistributed amount.
            if (i != _bptIndex) {
                amountsOut[i] = balances[i];
            }
        }

        return (bptAmountIn, amountsOut);
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
        uint256 numTokens = _getMaxTokens();
        uint256[] memory scalingFactors = new uint256[](numTokens);
        for(uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = FixedPoint.ONE;
        }
        return scalingFactors;
    }

}
