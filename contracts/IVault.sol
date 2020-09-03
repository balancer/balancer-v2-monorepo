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
    function newPool() external returns (uint256);

    // Pool config queries

    // Trading with a pool requires either trusting the controller, or going through
    // a proxy that enforces expected conditions (such as pool make up and fees)
    function getController(uint256 poolId) external view returns (address);

    // Can the pool be traded against
    function isPaused(uint256 poolId) external view returns (bool);
    function getSwapFee(uint256 poolId) external view returns (uint);

    function getNumTokens(uint256 poolId) external view returns (uint); // do we need this?
    function getTokens(uint256 poolId) external view returns (address[] memory tokens);
    function isTokenBound(uint256 poolId, address token) external view returns (bool);

    function getTokenBalance(uint256 poolId, address token) external view returns (uint);

    function getTokenNormalizedWeight(uint256 poolId, address token) external view returns (uint);
    // do we need these two?
    function getTokenDenormalizedWeight(uint256 poolId, address token) external view returns (uint);
    function getTotalDenormalizedWeight(uint256 poolId) external view returns (uint);

    // TBD if we expose these as-is, or provide lower-level primitives (possibly accounting for multiple curves)
    function getSpotPrice(uint256 poolId, address tokenIn, address tokenOut) external view returns (uint spotPrice);
    function getSpotPriceSansFee(uint256 poolId, address tokenIn, address tokenOut) external view returns (uint spotPrice);

    // Pool configuration - only callable by the controller

    function setController(uint256 poolId, address manager) external;
    function setPaused(uint256 poolId, bool paused) external;
    function setSwapFee(uint256 poolId, uint swapFee) external;

    // Adds a new token to a pool, with initial balance and (denorm) weight
    function bind(uint256 poolId, address token, uint balance, uint denorm) external;

    // Removes a token from a pool, withdrawing all balance
    function unbind(uint256 poolId, address token) external;

    // Updates a token's config in a pool, with new (denorm) weight and balance (depositing or withdrawing depending on current state)
    function rebind(uint256 poolId, address token, uint balance, uint denorm) external;

    // Trading interface

    // Swap interfaces are TBD

    function swapExactAmountIn(
        uint256 poolId,
        address tokenIn,
        uint tokenAmountIn,
        address tokenOut,
        uint minAmountOut,
        uint maxPrice
    ) external returns (uint tokenAmountOut, uint spotPriceAfter);

    function swapExactAmountOut(
        uint256 poolId,
        address tokenIn,
        uint maxAmountIn,
        address tokenOut,
        uint tokenAmountOut,
        uint maxPrice
    ) external returns (uint tokenAmountIn, uint spotPriceAfter);
}
