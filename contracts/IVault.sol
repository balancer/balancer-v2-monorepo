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

interface IVault {
    function newPool(bytes32) external returns (bytes32);

    // Pool config queries

    // Trading with a pool requires either trusting the controller, or going through
    // a proxy that enforces expected conditions (such as pool make up and fees)
    function getController(bytes32 poolId) external view returns (address);

    // Can the pool be traded against
    function isPaused(bytes32 poolId) external view returns (bool);
    function getSwapFee(bytes32 poolId) external view returns (uint);

    function getNumPoolTokens(bytes32 poolId) external view returns (uint); // do we need this?
    //function getTokens(bytes32 poolId) external view returns (address[] memory tokens);
    function getTokenAmountsIn(bytes32 poolId, uint ratio, uint[] calldata maxAmountsIn) external returns (uint[] memory);
    function getTokenAmountsOut(bytes32 poolId, uint ratio, uint[] calldata minAmountsOut) external returns (uint[] memory);
    function getPoolTokenBalance(bytes32 poolId, address token) external view returns (uint);
    function getPoolTokens(bytes32 poolId) external view returns (address[] memory);

    function isTokenBound(bytes32 poolId, address token) external view returns (bool);

    function getTokenBalance(bytes32 poolId, address token) external view returns (uint);

    function getTokenNormalizedWeight(bytes32 poolId, address token) external view returns (uint);
    // do we need these two?
    function getTokenDenormalizedWeight(bytes32 poolId, address token) external view returns (uint);
    function getTotalDenormalizedWeight(bytes32 poolId) external view returns (uint);

    // TBD if we expose these as-is, or provide lower-level primitives (possibly accounting for multiple curves)
    function getSpotPrice(bytes32 poolId, address tokenIn, address tokenOut) external view returns (uint spotPrice);
    function getSpotPriceSansFee(bytes32 poolId, address tokenIn, address tokenOut) external view returns (uint spotPrice);

    // Pool configuration - only callable by the controller

    function setController(bytes32 poolId, address controller) external;
    function setPaused(bytes32 poolId, bool paused) external;
    function setSwapFee(bytes32 poolId, uint swapFee) external;

    // TODO rework bind functions to minimize trust of controllers
    // Adds a new token to a pool, with initial balance and (denorm) weight
    function bind(bytes32 poolId, address token, uint balance, uint denorm) external;

    // Removes a token from a pool, withdrawing all balance
    function unbind(bytes32 poolId, address token) external;

    // functions for adding several tokens minting/burning bpt
    function addInitialLiquidity(bytes32 poolId, address[] calldata initialTokens, uint[] calldata amountsIn) external;
    function addLiquidity(bytes32 poolId, uint[] calldata amountsIn) external;
    function removeLiquidity(bytes32 poolId, address recipient, uint[] calldata amountsOut) external;

    // Updates a token's config in a pool, with new (denorm) weight and balance (depositing or withdrawing depending on current state)
    function rebind(bytes32 poolId, address token, uint balance, uint denorm) external;

    // Trading interface

    // Swap interfaces are TBD
}
