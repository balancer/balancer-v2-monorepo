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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../vault/IVault.sol";
import "../investmentManagers/InvestmentManager.sol";
import "../math/FixedPoint.sol";

interface IAToken {
    function redeem(uint256 amount) external;
}

interface ILendingPool {
    function deposit(
        address reserveAddress,
        uint256 amount,
        uint256 referralCode
    ) external;
}

contract AaveDaiInvestmentManager is InvestmentManager {
    using FixedPoint for uint128;
    using SafeCast for uint256;

    constructor(IVault vault, address token) InvestmentManager(vault, token) {}

    // Addresses subject to change
    // https://docs.aave.com/developers/deployed-contracts/deployed-contract-instances
    address
        internal constant _LENDING_POOL_CORE = 0x3dfd23A6c5E8BbcFc9581d2E864a68feb6a076d3;
    address
        internal constant _LENDING_POOL_ADDRESS = 0x398eC7346DcD622eDc5ae82352F02bE94C62d119;
    address
        internal constant _RESERVE_ADDRESS = 0x6B175474E89094C44Da98b954EedeAC495271d0F; // for Dai
    address
        internal constant _ATOKEN_ADDRESS = 0xfC1E690f61EFd961294b3e1Ce3313fBD8aa4f85d; // For aDai

    function initialize() public override {
        // grant allowance to vault


            uint256 MAX_INT
         = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
        _token.approve(address(_vault), MAX_INT);
        _token.approve(address(_LENDING_POOL_CORE), MAX_INT);
    }

    // transfers capital out, for invesment
    // TODO restrict
    function sow(uint128 amount) public {
        cash -= amount;

        uint256 referralCode = 0;
        ILendingPool(_LENDING_POOL_ADDRESS).deposit(
            _RESERVE_ADDRESS,
            amount,
            referralCode
        );
    }

    // calls capital back in from investments
    // TODO restrict
    function reap(uint128 amount) public {
        IAToken(_ATOKEN_ADDRESS).redeem(amount);

        cash += amount;
    }
}
