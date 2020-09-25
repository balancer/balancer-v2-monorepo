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

pragma solidity 0.5.12;

interface ICurve {
    function outGivenIn(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn
    ) external view returns (uint256);

    function calculateInvariant(uint256[] calldata balances)
        external
        view
        returns (uint256);

    function validateBalances(
        uint256[] calldata oldBalances,
        uint256[] calldata newBalances
    ) external view returns (bool);

    //TODO: for invariants that need storage writing we can define different interfaces
    //or just a one function named updateInvariant that is called just before
}
