// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IStaticATokenLM.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/ERC20Mock.sol";

contract MockStaticATokenLM is ERC20Mock, IStaticATokenLM {
    // Mock event to log calls, taken from
    // https://github.com/aave/protocol-v2/blob/ac58fea62bb8afee23f66197e8bce6d79ecda292/contracts/protocol/tokenization/StaticATokenLM.sol
    event Deposit(address depositor, address recipient, uint256 amount, uint16 referralCode, bool fromUnderlying);

    event Withdraw(address owner, address recipient, uint256 staticAmount, uint256 dynamicAmount, bool toUnderlying);

    uint256 private constant _rate = 1e27;
    IERC20 private immutable _ASSET;
    IERC20 private immutable _ATOKEN;

    constructor(
        string memory name,
        string memory symbol,
        IERC20 underlyingAsset,
        IERC20 aToken
    ) ERC20Mock(name, symbol) {
        _ASSET = underlyingAsset;
        _ATOKEN = aToken;
    }

    // solhint-disable-next-line func-name-mixedcase
    function ASSET() external view override returns (IERC20) {
        return _ASSET;
    }

    function ATOKEN() external view override returns (IERC20) {
        return _ATOKEN;
    }

    // solhint-disable-next-line func-name-mixedcase
    function LENDING_POOL() external pure override returns (address) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function rate() public pure override returns (uint256) {
        return _rate;
    }

    function deposit(
        address recipient,
        uint256 amount,
        uint16 referralCode,
        bool fromUnderlying
    ) external override returns (uint256) {
        emit Deposit(msg.sender, recipient, amount, referralCode, fromUnderlying);
        return amount;
    }

    function withdraw(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external override returns (uint256, uint256) {
        emit Withdraw(msg.sender, recipient, amount, staticToDynamicAmount(amount), toUnderlying);
        return (amount, amount);
    }

    function staticToDynamicAmount(uint256 amount) public pure override returns (uint256) {
        return amount;
    }

    function dynamicToStaticAmount(uint256 amount) external pure override returns (uint256) {
        return amount;
    }

    function permit(
        address,
        address,
        uint256,
        uint256,
        uint8,
        bytes32,
        bytes32
    ) public pure override {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getDomainSeparator() public pure override returns (bytes32) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function withdrawDynamicAmount(
        address,
        uint256,
        bool
    ) external pure override returns (uint256, uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function metaDeposit(
        address,
        address,
        uint256,
        uint16,
        bool,
        uint256,
        SignatureParams calldata
    ) external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function metaWithdraw(
        address,
        address,
        uint256,
        uint256,
        bool,
        uint256,
        SignatureParams calldata
    ) external pure override returns (uint256, uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function dynamicBalanceOf(address) external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function collectAndUpdateRewards() external pure override {
        _revert(Errors.UNIMPLEMENTED);
    }

    function claimRewardsOnBehalf(
        address,
        address,
        bool
    ) external pure override {
        _revert(Errors.UNIMPLEMENTED);
    }

    function claimRewards(address, bool) external pure override {
        _revert(Errors.UNIMPLEMENTED);
    }

    function claimRewardsToSelf(bool) external pure override {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getTotalClaimableRewards() external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getClaimableRewards(address) external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getUnclaimedRewards(address) external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getAccRewardsPerToken() external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getLifetimeRewardsClaimed() external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getLifetimeRewards() external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getLastRewardBlock() external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function INCENTIVES_CONTROLLER() external pure override returns (address) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function REWARD_TOKEN() external pure override returns (IERC20) {
        _revert(Errors.UNIMPLEMENTED);
    }
}
