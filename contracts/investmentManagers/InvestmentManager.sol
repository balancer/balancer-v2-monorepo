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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "../vault/IVault.sol";
import "./IInvestmentManager.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../math/FixedPoint.sol";

// solhint-disable var-name-mixedcase

contract InvestmentManager is IInvestmentManager {
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    // an only-increasing accumulator that is like an exchange rate between the accounting units and the
    // asset invested
    // Increases as returns accrue, ie if it started at 100 and the investment returned 5% it would now be 105
    uint128 public presentValue;
    IERC20 internal _token;

    uint128 public cash; // how much sits in cash - ideally 0
    uint128 public total; // total

    struct Investment {
        uint128 amount; // amount added at time t
        uint128 asOf; // relative value of amount added at time t
    }

    // pool investments
    mapping(bytes32 => Investment) public investments;

    // Investment and Divestment into this contract
    event Invested(bytes32 poolId, uint128 amount);
    event Divested(bytes32 poolId, uint128 amount);

    IVault internal immutable _vault;

    constructor(IVault vault, address token) {
        _vault = vault;
        _token = IERC20(token);
        presentValue = FixedPoint.ONE;
    }

    // allows the vault to do anything with the tokens held as cash
    function initialize() public virtual {
        // grant allowance to vault

        uint256 MAX_INT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
        _token.approve(address(_vault), MAX_INT);
    }

    modifier onlyVault {
        require(msg.sender == address(_vault), "callback only callable by vault");
        _;
    }

    // Callback after the vault sends tokens
    function recordPoolInvestment(bytes32 poolId, uint128 tokensIn) external override onlyVault {
        uint128 amountIn = tokensIn.div128(presentValue);

        if (investments[poolId].amount == 0) {
            investments[poolId] = Investment({ amount: amountIn, asOf: presentValue });
        } else {
            // when there is already an investment we need to scale it to current values
            uint128 currentValue = investments[poolId].amount.mul128(presentValue).div128(investments[poolId].asOf);
            investments[poolId].amount = amountIn + currentValue;
            investments[poolId].asOf = presentValue;
        }
        total = total.add128(amountIn);
        cash = cash.add128(amountIn);

        emit Invested(poolId, amountIn);
    }

    // Callback after the vault pulls tokens
    function recordPoolDivestment(bytes32 poolId, uint128 tokensOut) external override onlyVault {
        uint128 amountOut = tokensOut.div128(presentValue);

        require(investments[poolId].amount != 0, "There must be an existing investment to divest");
        // when there is already an investment we need to scale it to current values
        uint128 currentValue = investments[poolId].amount.mul128(presentValue).div128(investments[poolId].asOf);
        investments[poolId].amount = currentValue.sub128(amountOut);
        investments[poolId].asOf = presentValue;

        cash = cash.sub128(amountOut);
        total = total.sub128(amountOut);
        emit Divested(poolId, amountOut);
    }

    // Update the vaults notion of a pool's total token balance
    function updateInvested(bytes32 poolId) external {
        require(investments[poolId].amount != 0, "No investment was made for this pool yet");

        uint128 currentValue = investments[poolId].amount.mul128(presentValue).div128(investments[poolId].asOf);
        _vault.updateInvested(poolId, _token, currentValue);
    }
}
