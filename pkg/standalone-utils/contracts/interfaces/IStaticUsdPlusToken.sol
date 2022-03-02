// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

interface IStaticUsdPlusToken is IERC20 {

    /**
     * @dev Wrap UsdPlusToken. Caller should approve `amount` for transferFrom
     * @param recipient The address that will receive StaticUsdPlusTokens
     * @param amount The amount of UsdPlusTokens to wrap
     * @return uint256 The amount of StaticUsdPlusTokens minted to recipient, static balance
     **/
    function wrap(address recipient, uint256 amount) external returns (uint256);

    /**
     * @dev Unwrap StaticUsdPlusToken. Caller should approve `amount` for transferFrom
     * @param recipient The address that will receive unwrapped UsdPlusTokens
     * @param amount The amount of UsdTokens to wrap
     * @return uint256 The amount of StaticUsdPlusTokens burned, static balance
     * @return uint256 The amount of UsdPlusTokens sent to recipient, dynamic balance
     **/
    function unwrap(address recipient, uint256 amount) external returns (uint256, uint256);

    /**
     * @dev Utility method to get the current UsdPlusToken balance of an user
     * @param account The address of the user
     * @return uint256 The UsdPlusToken balance
     **/
    function dynamicBalanceOf(address account) external view returns (uint256);

    /**
     * @dev Utility method to get converted from static to dynamic amount by rate
     * @param amount The static amount (StaticUsdPlusToken) to convert from
     * @return uint256 The dynamic amount (UsdPlusToken)
     **/
    function staticToDynamicAmount(uint256 amount) external view returns (uint256);

    /**
     * @dev Utility method to get converted from dynamic to static amount by rate
     * @param amount The dynamic amount (UsdPlusToken) to convert from
     * @return uint256 The static amount (StaticUsdPlusToken)
     **/
    function dynamicToStaticAmount(uint256 amount) external view returns (uint256);

    /**
     * @dev Returns UsdPlusToken liquidity index in e27 (ray)
     * @return rate Rate between StaticUsdPlusToken and UsdPlusToken in e27 (ray)
     **/
    function rate() external view returns (uint256);

    /**
     * @dev Returns UsdPlusToken address
     * @return address The address of UsdPlusToken
     **/
    function mainToken() external view returns (address);
}
