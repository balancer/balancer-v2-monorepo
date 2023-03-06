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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IChildChainGauge.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";

import "./BalancerMinter.sol";

/**
 * @dev Distributes bridged BAL tokens in child chains, using the same interface as the mainnet Balancer minter.
 *
 * This contract is analogous to the mainnet minter: it has the same interface and interacts with (L2) gauges in a
 * similar manner, keeping track of how many tokens were already distributed to each gauge and user.
 *
 * The difference with the mainnet minter is that this contract does not have a way of minting BAL directly: the tokens
 * are only minted in mainnet, and then bridged to L2s. Then, this contract accumulates the emissions received by
 * child chain gauges and distributes them to users.
 *
 * Every time the tokens are 'minted' (i.e. distributed) from a gauge to a given user, the pseudo minter will query the
 * child chain gauge for the total amount of tokes that need to be distributed to that user. By keeping track of the
 * amount that it has already distributed for that gauge / user, the pseudo minter can then transfer the difference
 * to the user and update the total transferred amount.
 */
contract L2BalancerPseudoMinter is BalancerMinter, SingletonAuthentication {
    event GaugeFactoryAdded(ILiquidityGaugeFactory indexed factory);
    event GaugeFactoryRemoved(ILiquidityGaugeFactory indexed factory);

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    mapping(ILiquidityGaugeFactory => bool) private _validFactories;

    constructor(IVault vault, IERC20 balancerToken)
        BalancerMinter(balancerToken, "Balancer Pseudo Minter", "1")
        SingletonAuthentication(vault)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @notice Adds a given child chain gauge factory to the allowlist.
     * @dev This is a permissioned function.
     * Reverts if the given factory was added beforehand; emits `GaugeFactoryAdded` event upon success.
     */
    function addGaugeFactory(ILiquidityGaugeFactory factory) external authenticate {
        require(!_validFactories[factory], "FACTORY_ALREADY_ADDED");
        _validFactories[factory] = true;
        emit GaugeFactoryAdded(factory);
    }

    /**
     * @notice Removes a given child chain gauge factory from the allowlist.
     * @dev This is a permissioned function.
     * Reverts if the given factory had not been added beforehand; emits `GaugeFactoryRemoved` event upon success.
     */
    function removeGaugeFactory(ILiquidityGaugeFactory factory) external authenticate {
        require(_validFactories[factory], "FACTORY_NOT_ADDED");
        _validFactories[factory] = false;
        emit GaugeFactoryRemoved(factory);
    }

    /**
     * @notice Returns true if the given child chain gauge factory is in the allowlist; false otherwise.
     */
    function isValidGaugeFactory(ILiquidityGaugeFactory factory) public view returns (bool) {
        return _validFactories[factory];
    }

    // Internal functions

    function _mintFor(address gauge, address user) internal override returns (uint256 tokensToMint) {
        tokensToMint = _updateGauge(gauge, user);
        _pseudoMint(user, tokensToMint);
    }

    function _mintForMany(address[] calldata gauges, address user) internal override returns (uint256 tokensToMint) {
        uint256 length = gauges.length;
        for (uint256 i = 0; i < length; ++i) {
            tokensToMint = tokensToMint.add(_updateGauge(gauges[i], user));
        }
        _pseudoMint(user, tokensToMint);
    }

    /**
     * @dev Checkpoints given gauge and updates the internal accounting with the total tokens that should be transfered
     * to the user since the start.
     *
     * @param gauge Gauge to checkpoint and query for total tokens to be transferred.
     * @param user User to query in the given gauge.
     * @return tokensToMint Amount of tokens to be transferred to the user, calculated as the difference between the
     * total amount of tokens as indicated by the gauge and the tokens that have already been transferred to the user.
     */
    function _updateGauge(address gauge, address user) internal returns (uint256 tokensToMint) {
        // First, we retrieve the factory address registered from the gauge.
        // If the factory address is allowlisted in this contract, we verify that the gauge was actually created by
        // the factory (otherwise it could be just a malicious gauge that claims to be created by an allowed factory).
        IChildChainGauge ccGauge = IChildChainGauge(gauge);
        ILiquidityGaugeFactory factory = ccGauge.factory();
        require(isValidGaugeFactory(factory), "INVALID_GAUGE_FACTORY");
        require(factory.isGaugeFromFactory(gauge), "INVALID_GAUGE");

        ccGauge.user_checkpoint(user);
        uint256 totalMint = ccGauge.integrate_fraction(user);
        tokensToMint = totalMint.sub(minted(user, gauge));

        if (tokensToMint > 0) {
            _setMinted(user, gauge, totalMint);
        }
    }

    /**
     * @dev Transfers tokens to user if the given amount is not zero.
     */
    function _pseudoMint(address user, uint256 tokensToMint) internal {
        if (tokensToMint > 0) {
            getBalancerToken().safeTransfer(user, tokensToMint);
        }
    }
}
