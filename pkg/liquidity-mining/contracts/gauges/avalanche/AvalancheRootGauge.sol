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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAvalancheBridgeLimitsProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "../StakelessGauge.sol";

// Initiate the bridge transfer on the Router.
interface IMultichainV4Router {
    function anySwapOutUnderlying(address token, address to, uint amount, uint toChainID) external;
}

interface IAnyswapV6ERC20 is IERC20 {
    function underlying() external returns(address);
}

/**
 * @notice Root Gauge for the Avalanche network.
 * @dev Uses the multichain bridge.
 * See general docs here: https://docs.multichain.org/getting-started/how-it-works/cross-chain-router
 * 
 */
contract AvalancheRootGauge is StakelessGauge {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    uint256 private constant _AVALANCHE_CHAIN_ID = 43114;

    IAnyswapV6ERC20 private constant _ANYSWAP_BAL_WRAPPER = IAnyswapV6ERC20(
        0xcb9d0b8CfD8371143ba5A794c7218D4766c493e2
    );

    IMultichainV4Router private immutable _multichainRouter;
    IAvalancheBridgeLimitsProvider private immutable _factory;

    // This value is kept in storage and not made immutable to allow for this contract to be proxyable
    address private _recipient;

    constructor(
        IMainnetBalancerMinter minter,
        IMultichainV4Router multichainRouter
    ) StakelessGauge(minter) {
        // Sanity check that the underlying token of the minter is the same we've wrapped for Avalanche.
        require(_ANYSWAP_BAL_WRAPPER.underlying() == address(minter.getBalancerToken()), "Invalid Wrapper Token");
        
        _multichainRouter = multichainRouter;
        _factory = IAvalancheBridgeLimitsProvider(msg.sender);
    }

    function initialize(address recipient, uint256 relativeWeightCap) external {
        // This will revert in all calls except the first one
        __StakelessGauge_init(relativeWeightCap);

        _recipient = recipient;
    }

    /**
     * @dev The address of the L2 recipient gauge.
     */
    function getRecipient() external view override returns (address) {
        return _recipient;
    }

    /**
     * @dev Return the Multichain Router contract used to bridge.
     */
    function getMultichainRouter() external view returns (IMultichainV4Router) {
        return _multichainRouter;
    }

    /**
     * @dev Return the AnySwap wrapper for the underlying BAL token.
     */
    function getAnyBAL() external pure returns (IERC20) {
        return IERC20(_ANYSWAP_BAL_WRAPPER);
    }

    function _postMintAction(uint256 mintAmount) internal override {
        (uint256 minBridgeAmount, uint256 maxBridgeAmount) =_factory.getAvalancheBridgeLimits();

        // This bridge extracts a fee in the token being transferred.
        // It is 0.1%, but subject to a minimum and a maximum, so it can be quite significant for small amounts
        // (e.g., around 50% if you transfer the current minimum of ~1.5 BAL).
        //
        // The bridge operation will fail (and not return the tokens) if the amount bounds are exceeded,
        // so validate the amount first.
        require(mintAmount >= minBridgeAmount, "Below Bridge Limit");
        require(mintAmount <= maxBridgeAmount, "Above Bridge Limit");

        // The underlying token will be transferred, and must be approved.
        _balToken.safeApprove(address(_multichainRouter), mintAmount);

        // Progress and results can be monitored using the multichain scanner:
        // https://scan.multichain.org/#/tx?params=<mainnet txid>
        _multichainRouter.anySwapOutUnderlying(
            address(_ANYSWAP_BAL_WRAPPER),
            _recipient,
            mintAmount,
            _AVALANCHE_CHAIN_ID
        );
    }
}
