// Implementation of pool for new issues of security tokens that allows price discovery
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: MIT"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IGeneralPool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "./utils/BokkyPooBahsDateTimeLibrary.sol";

contract PrimaryIssuePool is BasePool, IGeneralPool
{   
    using BokkyPooBahsDateTimeLibrary for uint;
    using Math for uint256;

    IERC20 private immutable _security;
    IERC20 private immutable _currency;

    uint256 private constant _TOTAL_TOKENS = 3; //Balancer pool token, Security token, Currency token (ie, paired token)

    uint256 private immutable _scalingFactorSecurity;
    uint256 private immutable _scalingFactorCurrency;

    uint256 private _minPrice;
    uint256 private _maxPrice;

    uint256 private _MAX_TOKEN_BALANCE;

    uint256 private _cutoffTime;
    uint256 private _startTime;

    uint256 private immutable _bptIndex;
    uint256 private immutable _securityIndex;
    uint256 private immutable _currencyIndex;

    address payable private balancerManager;

    struct Params {
        uint256 fee;
        uint256 minPrice;
        uint256 maxPrice;
    }

    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20 security;
        IERC20 currency;
        address[] assetManagers;
        uint256 minimumPrice;
        uint256 basePrice;
        uint256 maxSecurityOffered;
        uint256 issueFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        uint256 issueCutoffTime;
        address owner;
    }

    constructor(NewPoolParams memory params)
        BasePool(
            params.vault,
            IVault.PoolSpecialization.GENERAL,
            params.name,
            params.symbol,
            _sortTokens(params.security, params.currency, IERC20(this)),
            params.assetManagers,
            params.issueFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        // set tokens
        _security = params.security;
        _currency = params.currency;

        // Set token indexes
        (uint256 securityIndex, uint256 currencyIndex, uint256 bptIndex) = _getSortedTokenIndexes(
            params.security,
            params.currency,
            IERC20(this)
        );
        _bptIndex = bptIndex;
        _securityIndex = securityIndex;
        _currencyIndex = currencyIndex;

        // set scaling factors
        _scalingFactorSecurity = _computeScalingFactor(params.security);
        _scalingFactorCurrency = _computeScalingFactor(params.currency);

        // set price bounds
        _minPrice = params.minimumPrice;
        _maxPrice = params.basePrice;

        // set max total balance of securities
        _MAX_TOKEN_BALANCE = params.maxSecurityOffered;

        // set issue time bounds
        _cutoffTime = params.issueCutoffTime;
        _startTime = block.timestamp;

        //set owner 
        balancerManager = payable(params.owner);
    }

    function getSecurity() external view returns (address) {
        return address(_security);
    }

    function getCurrency() external view returns (address) {
        return address(_currency);
    }

    function initialize() external {
        // join the pool
        IAsset[] memory _assets = new IAsset[](2);
        _assets[0] = IAsset(address(_security));
        _assets[1] = IAsset(address(_currency));
        uint256[] memory _maxAmountsIn = new uint256[](2);
        _maxAmountsIn[0] = _MAX_TOKEN_BALANCE;
        _maxAmountsIn[1] = Math.div(_MAX_TOKEN_BALANCE, _minPrice, false);
        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _assets,
            maxAmountsIn: _maxAmountsIn,
            userData: "",
            fromInternalBalance: false
        });        
        getVault().joinPool(getPoolId(), balancerManager, address(this), request);                                
    }

    function exit() external {
        // exit the pool
        IAsset[] memory _assets = new IAsset[](2);
        _assets[0] = IAsset(address(_security));
        _assets[1] = IAsset(address(_currency));
        uint256[] memory _minAmountsOut = new uint256[](2);
        _minAmountsOut[0] = _MAX_TOKEN_BALANCE;
        _minAmountsOut[1] = Math.div(_MAX_TOKEN_BALANCE, _maxPrice, false);
        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest({
            assets: _assets,
            minAmountsOut: _minAmountsOut,
            userData: "",
            toInternalBalance: false
        });        
        getVault().exitPool(getPoolId(), address(this), balancerManager, request);                                
    }

    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public override onlyVault(request.poolId) view returns (uint256) {
        
        // ensure that swap request is not beyond issue's cut off time
        require(BokkyPooBahsDateTimeLibrary.addSeconds(_startTime, _cutoffTime) >= block.timestamp);

        // ensure that price is within price band

        uint256[] memory scalingFactors = _scalingFactors();
        Params memory params = Params({
            fee: getSwapFeePercentage(),
            minPrice: _minPrice,
            maxPrice: _maxPrice
        });

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            request.amount = _upscale(request.amount, scalingFactors[indexIn]);
            uint256 amountOut = _onSwapIn(request, balances, params);
            return _downscaleDown(amountOut, scalingFactors[indexOut]);
        } else if (request.kind == IVault.SwapKind.GIVEN_OUT){
            request.amount = _upscale(request.amount, scalingFactors[indexOut]);
            uint256 amountIn = _onSwapOut(request, balances, params);
            return _downscaleUp(amountIn, scalingFactors[indexIn]);
        }

    }

    function _onSwapIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        if (request.tokenIn == _security) {
            return _swapSecurityIn(request, balances, params);
        } else if (request.tokenIn == _currency) {
            return _swapCurrencyIn(request, balances, params);
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _swapSecurityIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenOut == _currency, Errors.INVALID_TOKEN);
        
        //returning currency for current price of security paid in, but only if new price of security do not go out of price band
        if(request.tokenOut==_currency){
            uint256 postPaidSecurityBalance = Math.add(balances[_securityIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidSecurityBalance, balances[_currencyIndex], false);
            uint256 postPaidCurrencyBalance = Math.sub(balances[_currencyIndex], tokenOutAmt);

            if(Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice)
                return tokenOutAmt;
            else
                return 0;
        }      
    }

    function _swapCurrencyIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenOut == _security, Errors.INVALID_TOKEN);
        
        //returning security for currency paid in at current price of security, but only if new price of security do not go out of price band
        if(request.tokenOut==_security){
            uint256 postPaidCurrencyBalance = Math.add(balances[_currencyIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidCurrencyBalance, balances[_securityIndex], false);
            uint256 postPaidSecurityBalance = Math.sub(balances[_securityIndex], tokenOutAmt);

            if(Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice)
                return tokenOutAmt;
            else
                return 0;
        }
    }

    function _onSwapOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        if (request.tokenOut == _security) {
            return _swapSecurityOut(request, balances, params);
        } else if (request.tokenOut == _currency) {
            return _swapCurrencyOut(request, balances, params);
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _swapSecurityOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _currency, Errors.INVALID_TOKEN);
        
        //returning security to be swapped out for paid in currency
        if(request.tokenIn==_currency){
            uint256 postPaidSecurityBalance = Math.sub(balances[_securityIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidSecurityBalance, balances[_currencyIndex], false);
            uint256 postPaidCurrencyBalance = Math.add(balances[_currencyIndex], tokenOutAmt);

            if(Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice)
                return tokenOutAmt;
            else
                return 0; 
        }
    }

    function _swapCurrencyOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _security, Errors.INVALID_TOKEN);
        
        //returning currency to be paid in for security paid in
        if(request.tokenIn==_security){
            uint256 postPaidCurrencyBalance = Math.sub(balances[_currencyIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidCurrencyBalance, balances[_securityIndex], false);
            uint256 postPaidSecurityBalance = Math.add(balances[_securityIndex], tokenOutAmt);

            if(Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice)
                return tokenOutAmt;
            else
                return 0;
        }
    }

    function _onInitializePool(
        bytes32,
        address sender,
        address recipient,
        uint256[] memory,
        bytes memory
    ) internal override whenNotPaused view returns (uint256, uint256[] memory) {

        //the primary issue pool is initialized by the balancer manager contract
        _require(sender == balancerManager, Errors.CALLER_IS_NOT_OWNER);
        _require(recipient == address(this), Errors.CALLER_IS_NOT_OWNER);

        uint256[] memory amountsIn = new uint256[](_TOTAL_TOKENS);
        //setting balancer pool token balance to maximum amount of security tokens that can potentially be sold (at the minimum price)
        amountsIn[_bptIndex] = _MAX_TOKEN_BALANCE;

        return (_MAX_TOKEN_BALANCE, amountsIn);
        
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
    )
        internal
        pure
        override
        returns (
            uint256,
            uint256[] memory
        )
    {
        _revert(Errors.UNHANDLED_JOIN_KIND);
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
    )
        internal
        pure
        override
        returns (
            uint256,
            uint256[] memory
        )
    {
        _revert(Errors.UNHANDLED_JOIN_KIND);
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        if (token == _security || token == _currency || token == IERC20(this)) {
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

}