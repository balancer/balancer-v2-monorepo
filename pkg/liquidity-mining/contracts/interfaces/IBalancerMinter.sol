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

import "./IBalancerTokenAdmin.sol";
import "./IGaugeController.sol";

interface IBalancerMinter {
    event Minted(address indexed recipient, address gauge, uint256 minted);

    /**
     * @notice Returns the address of the Balancer Governance Token
     */
    function getBalancerToken() external view returns (IERC20);

    /**
     * @notice Returns the address of the Balancer Token Admin contract
     */
    function getBalancerTokenAdmin() external view returns (IBalancerTokenAdmin);

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view returns (IGaugeController);

    /**
     * @notice Mint everything which belongs to `msg.sender` and send to them
     * @param gauge `LiquidityGauge` address to get mintable amount from
     */
    function mint(address gauge) external returns (uint256);

    /**
     * @notice Mint everything which belongs to `msg.sender` across multiple gauges
     * @param gauges List of `LiquidityGauge` addresses
     */
    function mintMany(address[] calldata gauges) external returns (uint256);

    /**
     * @notice Mint tokens for `user`
     * @dev Only possible when `msg.sender` has been approved by `user` to mint on their behalf
     * @param gauge `LiquidityGauge` address to get mintable amount from
     * @param user Address to mint to
     */
    function mintFor(address gauge, address user) external returns (uint256);

    /**
     * @notice Mint tokens for `user` across multiple gauges
     * @dev Only possible when `msg.sender` has been approved by `user` to mint on their behalf
     * @param gauges List of `LiquidityGauge` addresses
     * @param user Address to mint to
     */
    function mintManyFor(address[] calldata gauges, address user) external returns (uint256);

    /**
     * @notice The total number of tokens minted for `user` from `gauge`
     */
    function minted(address user, address gauge) external view returns (uint256);

    /**
     * @notice Whether `minter` is approved to mint tokens for `user`
     */
    function getMinterApproval(address minter, address user) external view returns (bool);

    /**
     * @notice Set whether `minter` is approved to mint tokens on your behalf
     */
    function setMinterApproval(address minter, bool approval) external;

    /**
     * @notice Set whether `minter` is approved to mint tokens on behalf of `user`, who has signed a message authorizing
     * them.
     */
    function setMinterApprovalWithSignature(
        address minter,
        bool approval,
        address user,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    // The below functions are near-duplicates of functions available above.
    // They are included for ABI compatibility with snake_casing as used in vyper contracts.
    // solhint-disable func-name-mixedcase

    /**
     * @notice Whether `minter` is approved to mint tokens for `user`
     */
    function allowed_to_mint_for(address minter, address user) external view returns (bool);

    /**
     * @notice Mint everything which belongs to `msg.sender` across multiple gauges
     * @dev This function is not recommended as `mintMany()` is more flexible and gas efficient
     * @param gauges List of `LiquidityGauge` addresses
     */
    function mint_many(address[8] calldata gauges) external;

    /**
     * @notice Mint tokens for `user`
     * @dev Only possible when `msg.sender` has been approved by `user` to mint on their behalf
     * @param gauge `LiquidityGauge` address to get mintable amount from
     * @param user Address to mint to
     */
    function mint_for(address gauge, address user) external;

    /**
     * @notice Toggle whether `minter` is approved to mint tokens for `user`
     */
    function toggle_approve_mint(address minter) external;
}
