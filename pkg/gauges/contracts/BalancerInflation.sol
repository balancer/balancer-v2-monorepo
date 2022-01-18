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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/AccessControl.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./interfaces/IBalancerToken.sol";

// solhint-disable not-rely-on-time

contract BalancerInflation is Authentication {
    using SafeMath for uint256;

    // TODO: set these constants appropriately
    uint256 private constant _INITIAL_RATE = 32165468432186542;
    uint256 private constant _RATE_REDUCTION_TIME = 365 days;
    uint256 private constant _RATE_REDUCTION_COEFFICIENT = 1189207115002721024; // 2 ** (1/4) * 1e18
    uint256 private constant _RATE_DENOMINATOR = 1e18;

    IVault private immutable _vault;
    IBalancerToken private immutable _balancerToken;

    event UpdateMiningParameters(uint256 time, uint256 rate, uint256 supply);

    // Supply Variables
    uint256 public miningEpoch;
    uint256 public startEpochTime = type(uint256).max; // Sentinel value for contract not being activated
    uint256 public startEpochSupply;
    uint256 public rate;

    constructor(IVault vault, IERC20 token) Authentication(bytes32(uint256(address(this)))) {
        // BalancerInflation is a singleton, so it simply uses its own address to disambiguate action identifiers
        _balancerToken = IBalancerToken(address(token));
        _vault = vault;
    }

    function getBalancerToken() external view returns (IERC20) {
        return _balancerToken;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    /**
     * @notice Initiate BAL token inflation schedule
     * @dev Reverts if contract does not have sole minting powers over BAL (and no other minters can be added).
     */
    function activate() external authenticate {
        require(startEpochTime == type(uint256).max, "Already activated");

        // We need to check that this contract can't be bypassed to mint more BAL in future.
        // If other addresses have minting rights over the BAL token then this inflation schedule
        // can be bypassed by minting new tokens directly on the BalancerGovernanceToken contract.

        // On the BalancerGovernanceToken contract the minter role's admin is the DEFAULT_ADMIN_ROLE.
        // No external function exists to change the minter role's admin so we cannot make the list of
        // minters immutable without being the only address with DEFAULT_ADMIN_ROLE.
        bytes32 minterRole = _balancerToken.MINTER_ROLE();
        bytes32 snapshotRole = _balancerToken.SNAPSHOT_ROLE();
        bytes32 adminRole = _balancerToken.DEFAULT_ADMIN_ROLE();

        require(_balancerToken.hasRole(adminRole, address(this)), "BalancerInflation is not an admin");

        // All other minters must be removed
        uint256 numberOfMinters = _balancerToken.getRoleMemberCount(minterRole);
        for (uint256 i = 0; i < numberOfMinters; ++i){
            address minter = _balancerToken.getRoleMember(minterRole, i);
            _balancerToken.revokeRole(minterRole, minter);
        }
        // Give this contract minting rights over the BAL token
        _balancerToken.grantRole(minterRole, address(this));

        // As we can't prevent admins from adding extra minters in future, in order to secure minting rights
        // this contract must then be the only admin. We then remove all other admins.
        // We want to maintain this contract as an admin such that the SNAPSHOT_ROLE can be assigned in future.
        uint256 numberOfAdmins = _balancerToken.getRoleMemberCount(adminRole);
        for (uint256 i = 0; i < numberOfAdmins; ++i){
            address admin = _balancerToken.getRoleMember(adminRole, i);
            if(admin != address(this)){
                _balancerToken.revokeRole(adminRole, admin);
            }
        }

        // BalancerGovernanceToken exposes a role-restricted `snapshot` function for performing onchain voting.
        // We delegate control over this to the Balancer Authorizer by removing this role from all current addresses
        // and exposing a function which defers to the Authorizer for access control.
        uint256 numberOfSnapshotters = _balancerToken.getRoleMemberCount(snapshotRole);
        for (uint256 i = 0; i < numberOfSnapshotters; ++i){
            address snapshotter = _balancerToken.getRoleMember(snapshotRole, i);
            _balancerToken.revokeRole(snapshotRole, snapshotter);
        }
        // Give this contract snapshotting rights over the BAL token
        _balancerToken.grantRole(snapshotRole, address(this));

        // Perform sanity checks to make sure we're not leaving the roles in a broken state
        require(_balancerToken.hasRole(minterRole, address(this)), "BalancerInflation is not a minter");
        require(_balancerToken.hasRole(adminRole, address(this)), "BalancerInflation has removed it own admin powers");
        require(_balancerToken.hasRole(snapshotRole, address(this)), "BalancerInflation is not a snapshotter");
        require(_balancerToken.getRoleMemberCount(minterRole) == 1, "Multiple minters exist");
        require(_balancerToken.getRoleMemberCount(adminRole) == 1, "Multiple admins exist");
        require(_balancerToken.getRoleMemberCount(snapshotRole) == 1, "Multiple snapshotters exist");

        // As BAL inflation is now enforced by this contract we can initialise the relevant variables.
        startEpochSupply = _balancerToken.totalSupply();
        startEpochTime = block.timestamp;
        rate = _INITIAL_RATE;
        emit UpdateMiningParameters(block.timestamp, _INITIAL_RATE, startEpochSupply);
    }

    /**
     * @notice Mint BAL tokens subject to the defined inflation schedule
     * @dev Callable only by addresses defined in the Balancer Authorizer contract
     */
    function mint(address to, uint256 amount) external authenticate {
        require(
            _balancerToken.totalSupply().add(amount) <= _availableSupply(),
            "Mint amount exceeds remaining available supply"
        );
        _balancerToken.mint(to, amount);
    }

    /**
     * @notice Perform a snapshot of BAL token balances
     * @dev Callable only by addresses defined in the Balancer Authorizer contract
     */
    function snapshot() external authenticate {
        _balancerToken.snapshot();
    }

    /**
     * @notice Maximum allowable number of tokens in existence (claimed or unclaimed)
     */
    function availableSupply() external view returns (uint256) {
        return _availableSupply();
    }

    /**
     * @notice Get timestamp of the current mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the current epoch
     */
    function startEpochTimeWrite() external returns (uint256) {
        return _startEpochTimeWrite();
    }

    /**
     * @notice Get timestamp of the next mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the next epoch
     */
    function futureEpochTimeWrite() external returns (uint256) {
        return _startEpochTimeWrite() + _RATE_REDUCTION_TIME;
    }

    /**
     * @notice Update mining rate and supply at the start of the epoch
     * @dev Callable by any address, but only once per epoch
     * Total supply becomes slightly larger if this function is called late
     */
    function updateMiningParameters() external {
        _updateMiningParameters();
    }

    /**
     * @notice How much supply is mintable from start timestamp till end timestamp
     * @param start Start of the time interval (timestamp)
     * @param end End of the time interval (timestamp)
     * @return Tokens mintable from `start` till `end`
     */
    function mintableInTimeframe(uint256 start, uint256 end) external view returns (uint256) {
        return _mintableInTimeframe(start, end);
    }

    // Internal functions

    function _getAuthorizer() internal view returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return _getAuthorizer().canPerform(actionId, account, address(this));
    }

    /**
     * @notice Maximum allowable number of tokens in existence (claimed or unclaimed)
     */
    function _availableSupply() internal view returns (uint256) {
        return startEpochSupply + (block.timestamp - startEpochTime) * rate;
    }

    /**
     * @notice Get timestamp of the current mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the current epoch
     */
    function _startEpochTimeWrite() internal returns (uint256) {
        uint256 _startEpochTime = startEpochTime;
        if (block.timestamp >= _startEpochTime + _RATE_REDUCTION_TIME) {
            _updateMiningParameters();
            return startEpochTime;
        }
        return _startEpochTime;
    }

    /**
     * @notice Update mining rate and supply at the start of the epoch
     * @dev Callable by any address, but only once per epoch
     * Total supply becomes slightly larger if this function is called late
     */
    function _updateMiningParameters() internal {
        uint256 _rate = (rate * _RATE_DENOMINATOR) / _RATE_REDUCTION_COEFFICIENT;
        uint256 _startEpochSupply = startEpochSupply + _rate * _RATE_REDUCTION_TIME;

        miningEpoch += 1;
        startEpochTime += _RATE_REDUCTION_TIME;
        rate = _rate;
        startEpochSupply = _startEpochSupply;

        emit UpdateMiningParameters(block.timestamp, _rate, _startEpochSupply);
    }

    /**
     * @notice How much supply is mintable from start timestamp till end timestamp
     * @param start Start of the time interval (timestamp)
     * @param end End of the time interval (timestamp)
     * @return Tokens mintable from `start` till `end`
     */
    function _mintableInTimeframe(uint256 start, uint256 end) internal view returns (uint256) {
        require(start <= end, "start > end");

        uint256 currentEpochTime = startEpochTime;
        uint256 currentRate = rate;

        // Special case if end is in future (not yet minted) epoch
        if (end > currentEpochTime + _RATE_REDUCTION_TIME) {
            currentEpochTime += _RATE_REDUCTION_TIME;
            currentRate = (currentRate * _RATE_DENOMINATOR) / _RATE_REDUCTION_COEFFICIENT;
        }

        require(end <= currentEpochTime + _RATE_REDUCTION_TIME, "too far in future");

        uint256 toMint = 0;
        for (uint256 epoch = 0; epoch < 999; ++epoch) {
            if (end >= currentEpochTime) {
                uint256 currentEnd = end;
                if (currentEnd > currentEpochTime + _RATE_REDUCTION_TIME) {
                    currentEnd = currentEpochTime + _RATE_REDUCTION_TIME;
                }

                uint256 currentStart = start;
                if (currentStart >= currentEpochTime + _RATE_REDUCTION_TIME) {
                    // We should never get here but what if...
                    break;
                } else if (currentStart < currentEpochTime) {
                    currentStart = currentEpochTime;
                }

                toMint += currentRate * (currentEnd - currentStart);

                if (start >= currentEpochTime) {
                    break;
                }
            }

            currentEpochTime -= _RATE_REDUCTION_TIME;
            // double-division with rounding made rate a bit less => good
            currentRate = (currentRate * _RATE_REDUCTION_COEFFICIENT) / _RATE_DENOMINATOR;
            assert(currentRate <= _INITIAL_RATE);
        }

        return toMint;
    }

    // The below functions are duplicates of functions available above.
    // They are included for ABI compatibility with snake_casing as used in vyper contracts.
    // solhint-disable func-name-mixedcase

    function available_supply() external view returns (uint256) {
        return _availableSupply();
    }

    /**
     * @notice Get timestamp of the current mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the current epoch
     */
    function start_epoch_time_write() external returns (uint256) {
        return _startEpochTimeWrite();
    }

    /**
     * @notice Get timestamp of the next mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the next epoch
     */
    function future_epoch_time_write() external returns (uint256) {
        return _startEpochTimeWrite() + _RATE_REDUCTION_TIME;
    }

    /**
     * @notice Update mining rate and supply at the start of the epoch
     * @dev Callable by any address, but only once per epoch
     * Total supply becomes slightly larger if this function is called late
     */
    function update_mining_parameters() external {
        _updateMiningParameters();
    }

    /**
     * @notice How much supply is mintable from start timestamp till end timestamp
     * @param start Start of the time interval (timestamp)
     * @param end End of the time interval (timestamp)
     * @return Tokens mintable from `start` till `end`
     */
    function mintable_in_timeframe(uint256 start, uint256 end) external view returns (uint256) {
        return _mintableInTimeframe(start, end);
    }
}
