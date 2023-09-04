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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IL1StandardBridge.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "../StakelessGauge.sol";

contract BaseRootGauge is StakelessGauge {
    using SafeERC20 for IERC20;

    // Unlike on Optimism, on Base we do not need to maintain a dynamic gas limit in the factory to pass along
    // on calls to the bridge.
    //
    // The gas limit on L2 is computed based in part upon the _MIN_GAS_LIMIT passed in on the bridge call.
    // However, this value has a "floor" of RELAY_CONSTANT_OVERHEAD, set to 200_000. Since this floor is already
    // twice the gas actually required to simply mint BAL, we can just pass in 0 for `_minGasLimit`, and the full
    // computation will yield a total gas limit of around 288k.
    //
    // This parameter is provided for non-standard bridge tokens, or other unforeseen edge cases where more gas
    // might be required. We do not need it for our simple, conforming token.
    // solhint-disable-next-line max-line-length
    // See https://github.com/ethereum-optimism/optimism/blob/595d5916e568ee4fcff5cb8d236a05361a50a881/packages/contracts-bedrock/src/universal/CrossDomainMessenger.sol#L331
    uint32 private constant _MIN_GAS_LIMIT = 0;

    IL1StandardBridge private immutable _baseL1StandardBridge;

    // solhint-disable-next-line max-line-length
    // The original BAL token was redeployed; explanation here: https://github.com/balancer/balancer-deployments/pull/77#issue-1848405451
    address private immutable _baseBal;

    // This value is kept in storage and not made immutable to allow for this contract to be proxyable
    address private _recipient;

    constructor(
        IMainnetBalancerMinter minter,
        IL1StandardBridge baseL1StandardBridge,
        address baseBal
    ) StakelessGauge(minter) {
        _baseL1StandardBridge = baseL1StandardBridge;
        _baseBal = baseBal;
    }

    function initialize(address recipient, uint256 relativeWeightCap) external {
        // This will revert in all calls except the first one
        __StakelessGauge_init(relativeWeightCap);

        _recipient = recipient;
    }

    function getRecipient() external view override returns (address) {
        return _recipient;
    }

    function getBaseL1StandardBridge() external view returns (IL1StandardBridge) {
        return _baseL1StandardBridge;
    }

    function getBaseBal() external view returns (address) {
        return _baseBal;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        _balToken.safeApprove(address(_baseL1StandardBridge), mintAmount);

        // This will transfer BAL to `_recipient` on the Base chain
        _baseL1StandardBridge.depositERC20To(address(_balToken), _baseBal, _recipient, mintAmount, _MIN_GAS_LIMIT, "");
    }
}
