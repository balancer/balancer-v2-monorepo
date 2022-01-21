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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";

import "./interfaces/IBalancerTokenAdmin.sol";
import "./interfaces/IGaugeController.sol";
import "./interfaces/ILiquidityGauge.sol";

contract BalancerMinter is ReentrancyGuard {
    using SafeMath for uint256;

    IBalancerTokenAdmin private immutable _tokenAdmin;
    IGaugeController private immutable _gaugeController;

    event Minted(address indexed recipient, address gauge, uint256 minted);

    // user -> gauge -> value
    mapping(address => mapping(address => uint256)) private _minted;
    // minter -> user -> can mint?
    mapping(address => mapping(address => bool)) private _allowedMinter;

    constructor(IBalancerTokenAdmin tokenAdmin, IGaugeController gaugeController) {
        _tokenAdmin = tokenAdmin;
        _gaugeController = gaugeController;
    }

    /**
     * @notice Returns the address of the Balancer Token Admin contract
     */
    function getBalancerTokenAdmin() external view returns (address) {
        return address(_tokenAdmin);
    }

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view returns (IGaugeController) {
        return _gaugeController;
    }

    /**
     * @notice Mint everything which belongs to `msg.sender` and send to them
     * @param gauge `LiquidityGauge` address to get mintable amount from
     */
    function mint(address gauge) external nonReentrant {
        _mintFor(gauge, msg.sender);
    }

    /**
     * @notice Mint everything which belongs to `msg.sender` across multiple gauges
     * @param gauges List of `LiquidityGauge` addresses
     */
    function mintMany(address[] calldata gauges) external nonReentrant {
        _mintForMany(gauges, msg.sender);
    }

    /**
     * @notice Mint tokens for `user`
     * @dev Only possible when `msg.sender` has been approved via `toggleApproveMint`
     * @param gauge `LiquidityGauge` address to get mintable amount from
     * @param user Address to mint to
     */
    function mintFor(address gauge, address user) external nonReentrant {
        require(_allowedMinter[msg.sender][user], "Caller not allowed to mint for user");
        _mintFor(gauge, user);
    }

    /**
     * @notice Mint tokens for `user` across multiple gauges
     * @dev Only possible when `msg.sender` has been approved via `toggleApproveMint`
     * @param gauges List of `LiquidityGauge` addresses
     * @param user Address to mint to
     */
    function mintManyFor(address[] calldata gauges, address user) external nonReentrant {
        require(_allowedMinter[msg.sender][user], "Caller not allowed to mint for user");
        _mintForMany(gauges, user);
    }

    /**
     * @notice The total number of tokens minted for `user` from `gauge`
     */
    function minted(address user, address gauge) external view returns (uint256) {
        return _minted[user][gauge];
    }

    /**
     * @notice Whether `minter` is approved to mint tokens for `user`
     */
    function approvedMinter(address minter, address user) external view returns (bool) {
        return _allowedMinter[minter][user];
    }

    /**
     * @notice Set whether `minter` is approved to mint tokens on your behalf
     */
    function setMinterApproval(address minter, bool approval) public {
        _allowedMinter[minter][msg.sender] = approval;
    }

    // Internal functions

    function _mintFor(address gauge, address user) internal {
        uint256 tokensToMint = _updateGauge(gauge, user);
        if (tokensToMint > 0) {
            _tokenAdmin.mint(user, tokensToMint);
        }
    }

    function _mintForMany(address[] calldata gauges, address user) internal {
        uint256 tokensToMint = 0;

        uint256 length = gauges.length;
        for (uint256 i = 0; i < length; ++i) {
            tokensToMint = tokensToMint.add(_updateGauge(gauges[i], user));
        }

        if (tokensToMint > 0) {
            _tokenAdmin.mint(user, tokensToMint);
        }
    }

    function _updateGauge(address gauge, address user) internal returns (uint256 tokensToMint) {
        require(_gaugeController.gauge_types(gauge) >= 0, "Gauge does not exist on Controller");

        ILiquidityGauge(gauge).user_checkpoint(user);
        uint256 totalMint = ILiquidityGauge(gauge).integrate_fraction(user);
        tokensToMint = totalMint.sub(_minted[user][gauge]);

        if (tokensToMint > 0) {
            _minted[user][gauge] = totalMint;
            emit Minted(user, gauge, totalMint);
        }
    }

    // The below functions are near-duplicates of functions available above.
    // They are included for ABI compatibility with snake_casing as used in vyper contracts.
    // solhint-disable func-name-mixedcase

    /**
     * @notice Whether `minter` is approved to mint tokens for `user`
     */
    function allowed_to_mint_for(address minter, address user) external view returns (bool) {
        return _allowedMinter[minter][user];
    }

    /**
     * @notice Mint everything which belongs to `msg.sender` across multiple gauges
     * @dev This function is not recommended as `mintMany()` is more flexible and gas efficient
     * @param gauges List of `LiquidityGauge` addresses
     */
    function mint_many(address[8] calldata gauges) external nonReentrant {
        for (uint256 i = 0; i < 8; ++i) {
            if (gauges[i] == address(0)) {
                break;
            }
            _mintFor(gauges[i], msg.sender);
        }
    }

    /**
     * @notice Mint tokens for `user`
     * @dev Only possible when `msg.sender` has been approved via `toggleApproveMint`
     * @param gauge `LiquidityGauge` address to get mintable amount from
     * @param user Address to mint to
     */
    function mint_for(address gauge, address user) external nonReentrant {
        if (_allowedMinter[msg.sender][user]) {
            _mintFor(gauge, user);
        }
    }

    /**
     * @notice Toggle whether `minter` is approved to mint tokens for `user`
     */
    function toggle_approve_mint(address minter) external {
        setMinterApproval(minter, !_allowedMinter[minter][msg.sender]);
    }
}
