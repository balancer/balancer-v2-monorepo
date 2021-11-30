// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

// solhint-disable-next-line max-line-length
// Based on https://github.com/aave/protocol-v2/blob/ac58fea62bb8afee23f66197e8bce6d79ecda292/contracts/interfaces/IStaticATokenLM.sol

interface IStaticATokenLM is IERC20 {
    struct SignatureParams {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /**
     * @notice Deposits `ASSET` in the Aave protocol and mints static aTokens to msg.sender
     * @param recipient The address that will receive the static aTokens
     * @param amount The amount of underlying `ASSET` to deposit (e.g. deposit of 100 USDC)
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *   0 if the action is executed directly by the user, without any middle-man
     * @param fromUnderlying bool
     * - `true` if the msg.sender comes with underlying tokens (e.g. USDC)
     * - `false` if the msg.sender already has aTokens (e.g. aUSDC)
     * @return uint256 The amount of StaticAToken minted from the static balance
     **/
    function deposit(
        address recipient,
        uint256 amount,
        uint16 referralCode,
        bool fromUnderlying
    ) external returns (uint256);

    /**
     * @notice Burns `amount` of static aToken, with the recipient receiving a corresponding amount of `ASSET`
     * @param recipient The address that will receive the amount of `ASSET` withdrawn from the Aave protocol
     * @param amount The amount to withdraw, in static balance of StaticAToken
     * @param toUnderlying bool
     * - `true` for the recipient to get underlying tokens (e.g. USDC)
     * - `false` for the recipient to get aTokens (e.g. aUSDC)
     * @return amountToBurn: StaticATokens burnt, static balance
     * @return amountToWithdraw: underlying/aToken sent to `recipient`'s dynamic balance
     **/
    function withdraw(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external returns (uint256, uint256);

    /**
     * @notice Burns `amount` of static aToken, with the recipient receiving a corresponding amount of `ASSET`
     * @param recipient The address that will receive the amount of `ASSET` withdrawn from the Aave protocol
     * @param amount The amount to withdraw from the dynamic balance of the aToken/underlying asset
     * @param toUnderlying bool
     * - `true` for the recipient to get underlying tokens (e.g. USDC)
     * - `false` for the recipient to get aTokens (e.g. aUSDC)
     * @return amountToBurn: StaticATokens burnt, static balance
     * @return amountToWithdraw: underlying/aToken sent to `recipient`'s dynamic balance
     **/
    function withdrawDynamicAmount(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external returns (uint256, uint256);

    /**
     * @notice Implements the permit function per
     * https://github.com/ethereum/EIPs/blob/8a34d644aacf0f9f8f00815307fd7dd5da07655f/EIPS/eip-2612.md
     * @param owner The owner of the funds
     * @param spender The spender
     * @param value The amount
     * @param deadline The deadline timestamp, type(uint256).max for max deadline
     * @param v Signature param
     * @param s Signature param
     * @param r Signature param
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @notice Allows depositing on Aave via a meta-transaction
     * https://github.com/ethereum/EIPs/blob/8a34d644aacf0f9f8f00815307fd7dd5da07655f/EIPS/eip-2612.md
     * @param depositor Source of the funds to deposit
     * @param recipient Address that will receive the staticATokens, usually same as `depositor`
     * @param value The amount to deposit
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *   0 if the action is executed directly by the user, without any middle-man
     * @param fromUnderlying bool
     * - `true` if the msg.sender comes with underlying tokens (e.g. USDC)
     * - `false` if the msg.sender already has aTokens (e.g. aUSDC)
     * @param deadline The deadline timestamp, type(uint256).max for max deadline
     * @param sigParams Signature params: v,r,s
     * @return uint256 The amount of StaticAToken minted from the static balance
     */
    function metaDeposit(
        address depositor,
        address recipient,
        uint256 value,
        uint16 referralCode,
        bool fromUnderlying,
        uint256 deadline,
        SignatureParams calldata sigParams
    ) external returns (uint256);

    /**
     * @notice Allows withdrawing from Aave via a meta-transaction
     * https://github.com/ethereum/EIPs/blob/8a34d644aacf0f9f8f00815307fd7dd5da07655f/EIPS/eip-2612.md
     * @param owner Address owning the staticATokens
     * @param recipient Address that will receive the underlying withdrawn from Aave
     * @param staticAmount The amount of staticAToken to withdraw. If > 0, `dynamicAmount` needs to be 0
     * @param dynamicAmount The amount of underlying/aToken to withdraw. If > 0, `staticAmount` needs to be 0
     * @param toUnderlying bool
     * - `true` for the recipient to get underlying tokens (e.g. USDC)
     * - `false` for the recipient to get aTokens (e.g. aUSDC)
     * @param deadline The deadline timestamp, type(uint256).max for max deadline
     * @param sigParams Signature params: v,r,s
     * @return amountToBurn: StaticATokens burnt, static balance
     * @return amountToWithdraw: underlying/aToken sent to `recipient`'s dynamic balance
     */
    function metaWithdraw(
        address owner,
        address recipient,
        uint256 staticAmount,
        uint256 dynamicAmount,
        bool toUnderlying,
        uint256 deadline,
        SignatureParams calldata sigParams
    ) external returns (uint256, uint256);

    /**
     * @notice Utility method to get the current aToken balance of an user, from their staticAToken balance
     * @param account The address of the user
     * @return uint256 The aToken balance
     **/
    function dynamicBalanceOf(address account) external view returns (uint256);

    /**
     * @notice Converts a static amount (scaled balance of an aToken) to the aToken/underlying value,
     * using the current liquidity index on Aave
     * @param amount The amount to convert from
     * @return uint256 The dynamic amount
     **/
    function staticToDynamicAmount(uint256 amount) external view returns (uint256);

    /**
     * @notice Converts an aToken or underlying amount to its aToken denomination as a
     * scaled balance: a function of the principal and liquidity index
     * @param amount The amount to convert from
     * @return uint256 The static (scaled) amount
     **/
    function dynamicToStaticAmount(uint256 amount) external view returns (uint256);

    /**
     * @notice Returns the Aave liquidity index of the underlying aToken, here called `rate`, as it is
     * an ever-increasing exchange rate
     * @return The liquidity index
     **/
    function rate() external view returns (uint256);

    /**
     * @notice Function to return a dynamic domain separator, in order to be compatible with forks
     * that have different chainId values
     * @return bytes32 The domain separator
     **/
    function getDomainSeparator() external view returns (bytes32);

    /**
     * @notice Claims rewards from `INCENTIVES_CONTROLLER`, and updates internal accounting.
     */
    function collectAndUpdateRewards() external;

    /**
     * @notice Claim rewards on behalf of a user, and send them to a receiver
     * @dev Only callable if sender is an approved claimer or acting onBehalfOf one
     * @param onBehalfOf The address to claim on behalf of
     * @param receiver The address to receive the rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewardsOnBehalf(
        address onBehalfOf,
        address receiver,
        bool forceUpdate
    ) external;

    /**
     * @notice Claim rewards and send them to a receiver
     * @param receiver The address to receive the rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewards(address receiver, bool forceUpdate) external;

    /**
     * @notice Claim rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewardsToSelf(bool forceUpdate) external;

    /**
     * @notice Get the total claimable rewards of the contract.
     * @return The current balance + pending rewards from the `_incentivesController`
     */
    function getTotalClaimableRewards() external view returns (uint256);

    /**
     * @notice Get the total claimable rewards for a user in WAD
     * @param user The address of the user
     * @return The claimable amount of rewards in WAD
     */
    function getClaimableRewards(address user) external view returns (uint256);

    /**
     * @notice The unclaimed rewards for a user in WAD
     * @param user The address of the user
     * @return The unclaimed amount of rewards in WAD
     */
    function getUnclaimedRewards(address user) external view returns (uint256);

    function getAccRewardsPerToken() external view returns (uint256);

    function getLifetimeRewardsClaimed() external view returns (uint256);

    function getLifetimeRewards() external view returns (uint256);

    function getLastRewardBlock() external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function LENDING_POOL() external returns (address);

    // solhint-disable-next-line func-name-mixedcase
    function INCENTIVES_CONTROLLER() external returns (address);

    // solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external returns (IERC20);

    // solhint-disable-next-line func-name-mixedcase
    function ASSET() external returns (IERC20);

    // solhint-disable-next-line func-name-mixedcase
    function REWARD_TOKEN() external returns (IERC20);
}
