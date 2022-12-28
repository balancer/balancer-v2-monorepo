// Implementation of pool for new issues of security tokens that allows price discovery
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

import "@balancer-labs/v2-interfaces/contracts/pool-primary/IPrimaryPool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IGeneralPool.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-primary/PrimaryPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

import "./utils/BokkyPooBahsDateTimeLibrary.sol";

import "./interfaces/IMarketMaker.sol";
import "./interfaces/IPrimaryIssuePoolFactory.sol";

contract PrimaryIssuePool is IPrimaryPool, BasePool, IGeneralPool {

    using PrimaryPoolUserData for bytes;
    using BokkyPooBahsDateTimeLibrary for uint256;
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;

    IERC20 private immutable _security;
    IERC20 private immutable _currency;

    uint256 private constant _TOTAL_TOKENS = 3; //Security token, Currency token (ie, paired token), Balancer pool token

    uint256 private constant _INITIAL_BPT_SUPPLY = 2**(112) - 1; //setting to max BPT allowed in Vault

    uint256 private immutable _scalingFactorSecurity;
    uint256 private immutable _scalingFactorCurrency;

    uint256 private immutable _minPrice;
    uint256 private immutable _maxPrice;
    uint256 private immutable _swapFee;

    uint256 private immutable _MAX_TOKEN_BALANCE;
    uint256 private immutable _cutoffTime;
    uint256 private immutable _startTime;
    string private _offeringDocs;

    uint256 private immutable _securityIndex;
    uint256 private immutable _currencyIndex;
    uint256 private immutable _bptIndex;

    address private immutable _balancerManager;

    struct Params {
        uint256 fee;
        uint256 minPrice;
        uint256 maxPrice;
    }

    event OpenIssue(address indexed security, uint256 openingPrice, address currency, uint256 securityOffered, uint256 cutoffTime, string offeringDocs);
    event Subscription(address indexed assetIn, address assetOut, uint256 amount, address investor, uint256 price, uint256 executionDate);

    constructor(
        IVault vault,
        IPrimaryIssuePoolFactory.FactoryPoolParams memory factoryPoolParams,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            factoryPoolParams.name,
            factoryPoolParams.symbol,
            _sortTokens(IERC20(factoryPoolParams.security), IERC20(factoryPoolParams.currency), this),
            new address[](_TOTAL_TOKENS),
            factoryPoolParams.swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // set tokens
        _security = IERC20(factoryPoolParams.security);
        _currency = IERC20(factoryPoolParams.currency);

        // Set token indexes
        (uint256 securityIndex, uint256 currencyIndex, uint256 bptIndex) = _getSortedTokenIndexes(
            IERC20(factoryPoolParams.security),
            IERC20(factoryPoolParams.currency),
            this
        );
        _securityIndex = securityIndex;
        _currencyIndex = currencyIndex;
        _bptIndex = bptIndex;

        // set scaling factors
        _scalingFactorSecurity = _computeScalingFactor(IERC20(factoryPoolParams.security));
        _scalingFactorCurrency = _computeScalingFactor(IERC20(factoryPoolParams.currency));

        // set price bounds
        _minPrice = factoryPoolParams.minimumPrice;
        _maxPrice = factoryPoolParams.basePrice;

        //swap fee
        _swapFee = factoryPoolParams.swapFeePercentage;

        // set max total balance of securities
        _MAX_TOKEN_BALANCE = factoryPoolParams.maxAmountsIn;

        // set issue time bounds
        _cutoffTime = factoryPoolParams.cutOffTime;
        _startTime = block.timestamp;

        //ipfs address of offering docs
        _offeringDocs = factoryPoolParams.offeringDocs;

        //set owner
        _balancerManager = owner;     

        emit OpenIssue(factoryPoolParams.security, 
                        factoryPoolParams.basePrice, 
                        factoryPoolParams.currency, 
                        factoryPoolParams.maxAmountsIn, 
                        factoryPoolParams.cutOffTime, 
                        factoryPoolParams.offeringDocs);
    }

    function getSecurity() external view override returns (IERC20) {
        return _security;
    }

    function getCurrency() external view override returns (IERC20) {
        return _currency;
    }

    function getMinimumPrice() external view override returns(uint256) {
        return _minPrice;
    }

    function getMaximumPrice() external view override returns(uint256) {
        return _maxPrice;
    }

    function getSecurityOffered() external view override returns(uint256) {
        return _MAX_TOKEN_BALANCE;
    }

    function getIssueCutoffTime() external view override returns(uint256) {
        return _cutoffTime;
    }

    function getSecurityIndex() external view override returns (uint256) {
        return _securityIndex;
    }

    function getCurrencyIndex() external view override returns (uint256) {
        return _currencyIndex;
    }

    function getBptIndex() public view override returns (uint256) {
        return _bptIndex;
    }

    function getOfferingDocuments() public view returns(string memory){
        return _offeringDocs;
    }

    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public override onlyVault(request.poolId) whenNotPaused returns (uint256) {
        // ensure that swap request is not beyond issue's cut off time
        require(BokkyPooBahsDateTimeLibrary.addSeconds(_startTime, _cutoffTime) >= block.timestamp, "TimeLimit Over");
        
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
        
        IERC20 security = _security;
        IERC20 currency = _currency;
        uint256 securityIndex = _securityIndex;
        uint256 currencyIndex = _currencyIndex;

        // returning currency for current price of security paid in,
        // but only if new price of security do not go out of price band
        uint256 postPaidSecurityBalance = Math.add(balances[securityIndex], request.amount);
        uint256 tokenOutAmt = Math.sub(balances[currencyIndex], balances[securityIndex].mulDown(balances[currencyIndex].divDown(postPaidSecurityBalance)));
        
        require (balances[currencyIndex] >= tokenOutAmt, "Insufficient currency balance");
        require (tokenOutAmt.divDown(request.amount) >= params.minPrice && tokenOutAmt.divDown(request.amount) <= params.maxPrice, "Price out of bound");
        //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_security), ERC20(address(_security)).name(), request.amount, request.from, tokenOutAmt, false);
        emit Subscription(address(security), address(currency), request.amount, request.from, tokenOutAmt, block.timestamp);
        return tokenOutAmt;        
    }

    function _swapCurrencyIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal returns (uint256) {
        _require(request.tokenOut == _security, Errors.INVALID_TOKEN);

        IERC20 security = _security;
        IERC20 currency = _currency;
        uint256 securityIndex = _securityIndex;
        uint256 currencyIndex = _currencyIndex;
        uint256 tokenOutAmt;
        
        // returning security for currency paid in at current price of security,
        // but only if new price of security do not go out of price band
        uint256 postPaidCurrencyBalance = Math.add(balances[currencyIndex], request.amount);
        if(balances[currencyIndex]!=0)
            tokenOutAmt = Math.sub(balances[securityIndex], balances[currencyIndex].mulDown(balances[securityIndex].divDown(postPaidCurrencyBalance)));
        else
            tokenOutAmt = postPaidCurrencyBalance.divDown(params.minPrice);
        if(request.amount.divDown(tokenOutAmt) < params.minPrice && balances[currencyIndex]!=0)
        {   
            tokenOutAmt = postPaidCurrencyBalance.divDown(params.minPrice);
        }
        
        require (balances[securityIndex] >= tokenOutAmt, "Insufficient security balance");
        require(request.amount.divDown(tokenOutAmt) >= params.minPrice && request.amount.divDown(tokenOutAmt) <= params.maxPrice, "Price out of bound");
        //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_currency), ERC20(address(_currency)).name(), request.amount, request.from, tokenOutAmt, true);
        emit Subscription(address(currency), address(security), request.amount, request.from, tokenOutAmt, block.timestamp);
        return tokenOutAmt;
    }

    function _onSwapOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal returns (uint256) {
        //BPT is only held by the pool manager transferred to it during pool initialization, so no BPT swap is supported
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
        require(request.amount < balances[_securityIndex], "Insufficient balance");

        IERC20 security = _security;
        IERC20 currency = _currency;
        uint256 securityIndex = _securityIndex;
        uint256 currencyIndex = _currencyIndex;
        uint256 tokenInAmt;

        //returning currency to be paid in for paid out security
        uint256 postPaidSecurityBalance = Math.sub(balances[securityIndex], request.amount);
        if(balances[currencyIndex]!=0)
            tokenInAmt = Math.sub(balances[securityIndex].mulDown(balances[currencyIndex].divDown(postPaidSecurityBalance)), balances[currencyIndex]);
        else
            tokenInAmt = postPaidSecurityBalance.mulDown(params.minPrice);
        if(tokenInAmt.divDown(request.amount) < params.minPrice && balances[currencyIndex]!=0)
        {   
            tokenInAmt = postPaidSecurityBalance.mulDown(params.minPrice);
        }
        
        require(tokenInAmt.divDown(request.amount) >= params.minPrice && tokenInAmt.divDown(request.amount) <= params.maxPrice, "Price out of bound");
        //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_currency), ERC20(address(_currency)).name(), request.amount, request.from, tokenInAmt, true);
        emit Subscription(address(currency), address(security), request.amount, request.from, tokenInAmt, block.timestamp);
        return tokenInAmt;
    }

    function _swapCurrencyOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal returns (uint256) {
        _require(request.tokenIn == _security, Errors.INVALID_TOKEN);
        require(request.amount < balances[_currencyIndex], "Insufficient balance");

        IERC20 security = _security;
        IERC20 currency = _currency;
        uint256 securityIndex = _securityIndex;
        uint256 currencyIndex = _currencyIndex;

        //returning security to be paid in for currency paid out
        uint256 postPaidCurrencyBalance = Math.sub(balances[currencyIndex], request.amount);
        uint256 tokenInAmt = Math.sub(balances[currencyIndex].mulDown(balances[securityIndex].divDown(postPaidCurrencyBalance)), balances[securityIndex]);

        require(request.amount.divDown(tokenInAmt) >= params.minPrice && request.amount.divDown(tokenInAmt) <= params.maxPrice, "Price out of bound");
        //IMarketMaker(_balancerManager).subscribe(getPoolId(), address(_security), address(_security), ERC20(address(_security)).name(), request.amount, request.from, tokenInAmt, false);
        emit Subscription(address(security), address(currency), request.amount, request.from, tokenInAmt, block.timestamp);
        return tokenInAmt;
    }

    function _onInitializePool(
        bytes32,
        address sender,
        address recipient,
        uint256[] memory,
        bytes memory userData
    ) internal view override whenNotPaused returns (uint256, uint256[] memory) {
        //the primary issue pool is initialized by the balancer manager contract
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
        _revert(Errors.UNHANDLED_BY_PRIMARY_POOL);
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
        PrimaryPoolUserData.ExitKind kind = userData.exitKind();
        if (kind != PrimaryPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            //usually exit pool reverts
            _revert(Errors.UNHANDLED_BY_PRIMARY_POOL);
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

    //inherited from Basepool
    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    //also inherited from Basepool, why does the Basepool have two getters that return the same thing ? 
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
        uint256 numTokens = _getMaxTokens();
        uint256[] memory scalingFactors = new uint256[](numTokens);
        for(uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = FixedPoint.ONE;
        }
        return scalingFactors;
    }
}
