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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

contract MockL2VotingEscrow is IERC20 {
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address user) external view override returns (uint256) {
        return _balances[user];
    }

    function allowance(address, address user) external view override returns (uint256) {
        return _balances[user];
    }

    function approve(address, uint256) external pure override returns (bool) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function transfer(address, uint256) external pure override returns (bool) {
        _revert(Errors.UNIMPLEMENTED);
    }

    // solhint-disable-next-line func-name-mixedcase
    function create_lock(uint256 value, uint256) external {
        _balances[msg.sender] = value;
        _totalSupply += value;
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external pure override returns (bool) {
        _revert(Errors.UNIMPLEMENTED);
    }
}
