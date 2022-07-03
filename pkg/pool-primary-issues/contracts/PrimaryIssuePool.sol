// Implementation of pool for new issues of security tokens that allows price discovery
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "@balancer-labs/v2-vault/contracts/PoolBalances.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IGeneralPool.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

import "./utils/BokkyPooBahsDateTimeLibrary.sol";

import "./interfaces/IMarketMaker.sol";

contract PrimaryIssuePool is BasePool, IGeneralPool {

    using BokkyPooBahsDateTimeLibrary for uint256;
    using Math for uint256;

    IERC20 private immutable _security;
    IERC20 private immutable _currency;

    uint256 private constant _TOTAL_TOKENS = 2; //Security token, Currency token (ie, paired token)

    uint256 private immutable _scalingFactorSecurity;
    uint256 private immutable _scalingFactorCurrency;

    uint256 private _minPrice;
    uint256 private _maxPrice;

    uint256 private _MAX_TOKEN_BALANCE;
    uint256 private _cutoffTime;
    uint256 private _startTime;

    uint256 private immutable _securityIndex;
    uint256 private immutable _currencyIndex;
    uint256 private immutable _bptIndex;

    address payable private _balancerManager;

    struct Params {
        uint256 fee;
        uint256 minPrice;
        uint256 maxPrice;
    }

    event OpenIssue(address indexed security, uint256 openingPrice, uint256 securityOffered);
    event Subscription(address indexed security, address assetIn, string assetName, uint256 amount, address investor, uint256 price);

    constructor(
        IVault vault,
        address security,
        address currency,
        uint256 minimumPrice,
        uint256 basePrice,
        uint256 maxSecurityOffered,
        uint256 issueFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        uint256 issueCutoffTime,
        address owner
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            ERC20(security).name(),
            ERC20(security).symbol(),
            _sortTokens(IERC20(security), IERC20(currency)),
            new address[](_TOTAL_TOKENS),
            issueFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // set tokens
        _security = IERC20(security);
        _currency = IERC20(currency);

        // Set token indexes
        (uint256 securityIndex, uint256 currencyIndex, uint256 bptIndex) = _getSortedTokenIndexes(
            IERC20(security),
            IERC20(currency),
            IERC20(this)
        );
        _securityIndex = securityIndex;
        _currencyIndex = currencyIndex;
        _bptIndex = bptIndex;

        // set scaling factors
        _scalingFactorSecurity = _computeScalingFactor(IERC20(security));
        _scalingFactorCurrency = _computeScalingFactor(IERC20(currency));

        // set price bounds
        _minPrice = minimumPrice;
        _maxPrice = basePrice;

        // set max total balance of securities
        _MAX_TOKEN_BALANCE = maxSecurityOffered;

        // set issue time bounds
        _cutoffTime = issueCutoffTime;
        _startTime = block.timestamp;

        //set owner
        _balancerManager = payable(owner);        
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
        IVault _vault = getVault();
        _vault.joinPool(getPoolId(), _balancerManager, address(this), request);
        emit OpenIssue(address(_security), _minPrice, _maxAmountsIn[1]);
    }

    function exit() external {
        // exit the pool
        IAsset[] memory _assets = new IAsset[](2);
        _assets[0] = IAsset(address(_security));
        _assets[1] = IAsset(address(_currency));
        uint256[] memory _minAmountsOut = new uint256[](2);
        _minAmountsOut[0] = 0;
        _minAmountsOut[1] = Math.div(_MAX_TOKEN_BALANCE, _maxPrice, false);
        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest({
            assets: _assets,
            minAmountsOut: _minAmountsOut,
            userData: "",
            toInternalBalance: false
        });
        getVault().exitPool(getPoolId(), address(this), _balancerManager, request);
    }

    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public override onlyVault(request.poolId) returns (uint256) {
        // ensure that swap request is not beyond issue's cut off time
        require(BokkyPooBahsDateTimeLibrary.addSeconds(_startTime, _cutoffTime) >= block.timestamp);

        // ensure that price is within price band
        uint256[] memory scalingFactors = _scalingFactors();
        Params memory params = Params({ fee: getSwapFeePercentage(), minPrice: _minPrice, maxPrice: _maxPrice });

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            request.amount = _upscale(request.amount, scalingFactors[indexIn]);
            uint256 amountOut = _onSwapIn(request, balances, params);
            return _downscaleDown(amountOut, scalingFactors[indexOut]);
        } else if (request.kind == IVault.SwapKind.GIVEN_OUT) {
            request.amount = _upscale(request.amount, scalingFactors[indexOut]);
            uint256 amountIn = _onSwapOut(request, balances, params);
            return _downscaleUp(amountIn, scalingFactors[indexIn]);
        }
    }

    function _onSwapIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal returns (uint256) {
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
    ) internal returns (uint256) {
        _require(request.tokenOut == _currency, Errors.INVALID_TOKEN);

        // returning currency for current price of security paid in,
        // but only if new price of security do not go out of price band
        if (request.tokenOut == _currency) {
            uint256 postPaidSecurityBalance = Math.add(balances[_securityIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidSecurityBalance, balances[_currencyIndex], false);
            uint256 postPaidCurrencyBalance = Math.sub(balances[_currencyIndex], tokenOutAmt);

            if (
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice
            ){
                //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_security), ERC20(address(_security)).name(), request.amount, request.from, tokenOutAmt, false);
                emit Subscription(address(_security), address(_security), ERC20(address(_security)).name(), request.amount, request.from, tokenOutAmt);
                return tokenOutAmt;
            } 
            else 
                return 0;
        }
    }

    function _swapCurrencyIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal returns (uint256) {
        _require(request.tokenOut == _security, Errors.INVALID_TOKEN);

        // returning security for currency paid in at current price of security,
        // but only if new price of security do not go out of price band
        if (request.tokenOut == _security) {
            uint256 postPaidCurrencyBalance = Math.add(balances[_currencyIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidCurrencyBalance, balances[_securityIndex], false);
            uint256 postPaidSecurityBalance = Math.sub(balances[_securityIndex], tokenOutAmt);

            if (
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice
            ){
                //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_currency), ERC20(address(_currency)).name(), request.amount, request.from, tokenOutAmt, true);
                emit Subscription(address(_security), address(_currency), ERC20(address(_currency)).name(), request.amount, request.from, tokenOutAmt);
                return tokenOutAmt;
            }
            else 
                return 0;
        }
    }

    function _onSwapOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal returns (uint256) {
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
    ) internal returns (uint256) {
        _require(request.tokenIn == _currency, Errors.INVALID_TOKEN);

        //returning security to be swapped out for paid in currency
        if (request.tokenIn == _currency) {
            uint256 postPaidSecurityBalance = Math.sub(balances[_securityIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidSecurityBalance, balances[_currencyIndex], false);
            uint256 postPaidCurrencyBalance = Math.add(balances[_currencyIndex], tokenOutAmt);

            if (
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice
            ){
                //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_currency), ERC20(address(_currency)).name(), request.amount, request.from, tokenOutAmt, true);
                emit Subscription(address(_security), address(_currency), ERC20(address(_currency)).name(), request.amount, request.from, tokenOutAmt);
                return tokenOutAmt;
            }
            else 
                return 0;
        }
    }

    function _swapCurrencyOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal returns (uint256) {
        _require(request.tokenIn == _security, Errors.INVALID_TOKEN);

        //returning currency to be paid in for security paid in
        if (request.tokenIn == _security) {
            uint256 postPaidCurrencyBalance = Math.sub(balances[_currencyIndex], request.amount);
            uint256 tokenOutAmt = Math.div(postPaidCurrencyBalance, balances[_securityIndex], false);
            uint256 postPaidSecurityBalance = Math.add(balances[_securityIndex], tokenOutAmt);

            if (
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) >= params.minPrice &&
                Math.div(postPaidSecurityBalance, postPaidCurrencyBalance, false) <= params.maxPrice
            ){
                //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_security), ERC20(address(_security)).name(), request.amount, request.from, tokenOutAmt, false);
                emit Subscription(address(_security), address(_security), ERC20(address(_security)).name(), request.amount, request.from, tokenOutAmt);
                return tokenOutAmt;
            }
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
    ) internal view override whenNotPaused returns (uint256, uint256[] memory) {
        //the primary issue pool is initialized by the balancer manager contract
        _require(sender == _balancerManager, Errors.CALLER_IS_NOT_OWNER);
        _require(recipient == address(this), Errors.CALLER_IS_NOT_OWNER);

        uint256[] memory amountsIn = new uint256[](_TOTAL_TOKENS);

        return (0, amountsIn);
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
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNHANDLED_JOIN_KIND);
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        if (token == _security || token == _currency) {
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
