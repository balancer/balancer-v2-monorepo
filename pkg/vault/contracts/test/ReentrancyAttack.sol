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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

/**
 * @notice This contract demonstrates a read-only reentrancy attack attempt.
 * In the vulnerable version, during the ETH return callback, it would be able to read inconsistent state
 * (BPT minted but balances not yet updated in Vault). In the fixed version, the callback happens after storage
 * updates, so the state is consistent.
 */
contract ReentrancyAttack {
    IVault public immutable vault;

    bytes32 public immutable poolId;
    IERC20 public immutable pool;

    bool public consistentState;
    uint256 public supplyDuringCallback;

    uint256[] private _balancesDuringCallback;

    uint256 private initialSupply;
    uint256[] private initialBalances;

    constructor(
        address _vault,
        bytes32 _poolId,
        address _pool
    ) {
        vault = IVault(_vault);
        poolId = _poolId;
        pool = IERC20(_pool);
    }

    // Return the entire array of balances.
    function balancesDuringCallback() external view returns (uint256[] memory) {
        return _balancesDuringCallback;
    }

    /**
     * @dev Attempts to exploit read-only reentrancy.
     * Joins the pool with excess ETH, triggering a callback on ETH return.
     */
    function attemptReadOnlyReentrancy() external payable {
        // Get the initial state.
        (IERC20[] memory tokens, uint256[] memory balances, ) = vault.getPoolTokens(poolId);
        initialBalances = balances;

        // We can't directly get totalSupply in this context, but we'll check during the callback.
        initialSupply = 0;

        // Prepare join with excess ETH (will trigger callback when excess is returned).
        IAsset[] memory assets = new IAsset[](tokens.length);
        uint256[] memory maxAmountsIn = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            assets[i] = IAsset(address(tokens[i]));
            maxAmountsIn[i] = type(uint256).max;
        }

        // Join amounts (much less than ETH sent)
        uint256[] memory joinAmounts = new uint256[](tokens.length);
        joinAmounts[0] = 1e18;
        joinAmounts[1] = 1e18;

        uint256[] memory dueProtocolFees = new uint256[](tokens.length);

        bytes memory userData = abi.encode(joinAmounts, dueProtocolFees);

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: assets,
            maxAmountsIn: maxAmountsIn,
            userData: userData,
            fromInternalBalance: false
        });

        // This join will trigger the receive() callback when excess ETH is returned.
        vault.joinPool{ value: msg.value }(poolId, address(this), address(0), request);
    }

    /**
     * @dev This receive function is called when excess ETH is returned.
     * In the vulnerable version, this happens BEFORE storage is updated.
     * In the fixed version, this happens AFTER storage is updated.
     */
    receive() external payable {
        // Read the current pool state.
        (, uint256[] memory currentBalances, ) = vault.getPoolTokens(poolId);

        // Read the pool's total supply during the callback.
        // The MockPool adds 1 for each join, and subtracts 1 for each exit.

        // Store for verification in tests.
        _balancesDuringCallback = currentBalances;
        supplyDuringCallback = pool.totalSupply();

        // In the vulnerable version:
        // - BPT would be minted (supply increased)
        // - But balances not yet updated in Vault storage

        // If balances haven't changed from initial values, but the supply has, that's the vulnerability.
        if (initialBalances.length > 0) {
            bool balancesChanged = false;
            for (uint256 i = 0; i < initialBalances.length; i++) {
                if (currentBalances[i] != initialBalances[i]) {
                    balancesChanged = true;
                    break;
                }
            }

            // If balances are unchanged, it means the ETH callback is happening before the balance update, when
            // the Vault is in an inconsistent state.
            consistentState = supplyDuringCallback > 0 && balancesChanged;
        }
    }

    /// @dev Helper to approve vault to spend tokens.
    function approveVault(address[] memory tokenAddresses) external {
        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            IERC20(tokenAddresses[i]).approve(address(vault), type(uint256).max);
        }
    }
}
