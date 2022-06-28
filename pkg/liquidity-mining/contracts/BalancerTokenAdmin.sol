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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerTokenAdmin.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

// solhint-disable not-rely-on-time

/**
 * @title Balancer Token Admin
 * @notice This contract holds all admin powers over the BAL token passing through calls
 * while delegating access control to the Balancer Authorizer
 *
 * In addition, calls to the mint function must respect the inflation schedule as defined in this contract.
 * As this contract is the only way to mint BAL tokens this ensures that the maximum allowed supply is enforced
 * @dev This contract exists as a consequence of the gauge systems needing to know a fixed inflation schedule
 * in order to know how much BAL a gauge is allowed to mint. As this does not exist within the BAL token itself
 * it is defined here, we must then wrap the token's minting functionality in order for this to be meaningful.
 */
contract BalancerTokenAdmin is IBalancerTokenAdmin, SingletonAuthentication, ReentrancyGuard {
    using Math for uint256;

    // Initial inflation rate of 145k BAL per week.
    uint256 public constant override INITIAL_RATE = (145000 * 1e18) / uint256(1 weeks); // BAL has 18 decimals
    uint256 public constant override RATE_REDUCTION_TIME = 365 days;
    uint256 public constant override RATE_REDUCTION_COEFFICIENT = 1189207115002721024; // 2 ** (1/4) * 1e18
    uint256 public constant override RATE_DENOMINATOR = 1e18;

    IBalancerToken private immutable _balancerToken;

    event MiningParametersUpdated(uint256 rate, uint256 supply);

    // Supply Variables
    uint256 private _miningEpoch;
    uint256 private _startEpochTime = type(uint256).max; // Sentinel value for contract not being activated
    uint256 private _startEpochSupply;
    uint256 private _rate;

    constructor(IVault vault, IBalancerToken balancerToken) SingletonAuthentication(vault) {
        _balancerToken = balancerToken;
    }

    /**
     * @dev Returns the Balancer token.
     */
    function getBalancerToken() external view override returns (IBalancerToken) {
        return _balancerToken;
    }

    /**
     * @notice Initiate BAL token inflation schedule
     * @dev Reverts if contract does not have sole minting powers over BAL (and no other minters can be added).
     */
    function activate() external override nonReentrant authenticate {
        require(_startEpochTime == type(uint256).max, "Already activated");

        // We need to check that this contract can't be bypassed to mint more BAL in the future.
        // If other addresses had minting rights over the BAL token then this inflation schedule
        // could be bypassed by minting new tokens directly on the BalancerGovernanceToken contract.

        // On the BalancerGovernanceToken contract the minter role's admin is the DEFAULT_ADMIN_ROLE.
        // No external function exists to change the minter role's admin so we cannot make the list of
        // minters immutable without revoking all access to DEFAULT_ADMIN_ROLE.
        bytes32 minterRole = _balancerToken.MINTER_ROLE();
        bytes32 snapshotRole = _balancerToken.SNAPSHOT_ROLE();
        bytes32 adminRole = _balancerToken.DEFAULT_ADMIN_ROLE();

        require(_balancerToken.hasRole(adminRole, address(this)), "BalancerTokenAdmin is not an admin");

        // All other minters must be removed to avoid inflation schedule enforcement being bypassed.
        uint256 numberOfMinters = _balancerToken.getRoleMemberCount(minterRole);
        for (uint256 i = 0; i < numberOfMinters; ++i) {
            address minter = _balancerToken.getRoleMember(minterRole, 0);
            _balancerToken.revokeRole(minterRole, minter);
        }
        // Give this contract minting rights over the BAL token
        _balancerToken.grantRole(minterRole, address(this));

        // BalancerGovernanceToken exposes a role-restricted `snapshot` function for performing onchain voting.
        // We delegate control over this to the Balancer Authorizer by removing this role from all current addresses
        // and exposing a function which defers to the Authorizer for access control.
        uint256 numberOfSnapshotters = _balancerToken.getRoleMemberCount(snapshotRole);
        for (uint256 i = 0; i < numberOfSnapshotters; ++i) {
            address snapshotter = _balancerToken.getRoleMember(snapshotRole, 0);
            _balancerToken.revokeRole(snapshotRole, snapshotter);
        }
        // Give this contract snapshotting rights over the BAL token
        _balancerToken.grantRole(snapshotRole, address(this));

        // BalancerTokenAdmin now is the only holder of MINTER_ROLE and SNAPSHOT_ROLE for BalancerGovernanceToken.

        // We can't prevent any other admins from granting other addresses these roles however.
        // This undermines the ability for BalancerTokenAdmin to enforce the correct inflation schedule.
        // The only way to prevent this is for BalancerTokenAdmin to be the only admin. We then remove all other admins.
        uint256 numberOfAdmins = _balancerToken.getRoleMemberCount(adminRole);
        uint256 skipSelf = 0;
        for (uint256 i = 0; i < numberOfAdmins; ++i) {
            address admin = _balancerToken.getRoleMember(adminRole, skipSelf);
            if (admin != address(this)) {
                _balancerToken.revokeRole(adminRole, admin);
            } else {
                // This contract is now the admin with index 0, we now delete the address with index 1 instead
                skipSelf = 1;
            }
        }

        // BalancerTokenAdmin doesn't actually need admin rights any more and won't grant rights to any more addresses
        // We then renounce our admin role to ensure that another address won't gain absolute minting powers.
        _balancerToken.revokeRole(adminRole, address(this));

        // Perform sanity checks to make sure we're not leaving the roles in a broken state
        require(_balancerToken.getRoleMemberCount(adminRole) == 0, "Address exists with admin rights");
        require(_balancerToken.hasRole(minterRole, address(this)), "BalancerTokenAdmin is not a minter");
        require(_balancerToken.hasRole(snapshotRole, address(this)), "BalancerTokenAdmin is not a snapshotter");
        require(_balancerToken.getRoleMemberCount(minterRole) == 1, "Multiple minters exist");
        require(_balancerToken.getRoleMemberCount(snapshotRole) == 1, "Multiple snapshotters exist");

        // As BAL inflation is now enforced by this contract we can initialise the relevant variables.
        _startEpochSupply = _balancerToken.totalSupply();
        _startEpochTime = block.timestamp;
        _rate = INITIAL_RATE;
        emit MiningParametersUpdated(INITIAL_RATE, _startEpochSupply);
    }

    /**
     * @notice Mint BAL tokens subject to the defined inflation schedule
     * @dev Callable only by addresses defined in the Balancer Authorizer contract
     */
    function mint(address to, uint256 amount) external override authenticate {
        // Check if we've passed into a new epoch such that we should calculate available supply with a smaller rate.
        if (block.timestamp >= _startEpochTime.add(RATE_REDUCTION_TIME)) {
            _updateMiningParameters();
        }

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
     * @notice Returns the current epoch number.
     */
    function getMiningEpoch() external view returns (uint256) {
        return _miningEpoch;
    }

    /**
     * @notice Returns the start timestamp of the current epoch.
     */
    function getStartEpochTime() external view returns (uint256) {
        return _startEpochTime;
    }

    /**
     * @notice Returns the start timestamp of the next epoch.
     */
    function getFutureEpochTime() external view returns (uint256) {
        return _startEpochTime.add(RATE_REDUCTION_TIME);
    }

    /**
     * @notice Returns the available supply at the beginning of the current epoch.
     */
    function getStartEpochSupply() external view returns (uint256) {
        return _startEpochSupply;
    }

    /**
     * @notice Returns the current inflation rate of BAL per second
     */
    function getInflationRate() external view returns (uint256) {
        return _rate;
    }

    /**
     * @notice Maximum allowable number of tokens in existence (claimed or unclaimed)
     */
    function getAvailableSupply() external view returns (uint256) {
        return _availableSupply();
    }

    /**
     * @notice Get timestamp of the current mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the current epoch
     */
    function startEpochTimeWrite() external override returns (uint256) {
        return _startEpochTimeWrite();
    }

    /**
     * @notice Get timestamp of the next mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the next epoch
     */
    function futureEpochTimeWrite() external returns (uint256) {
        return _startEpochTimeWrite().add(RATE_REDUCTION_TIME);
    }

    /**
     * @notice Update mining rate and supply at the start of the epoch
     * @dev Callable by any address, but only once per epoch
     * Total supply becomes slightly larger if this function is called late
     */
    function updateMiningParameters() external {
        require(block.timestamp >= _startEpochTime.add(RATE_REDUCTION_TIME), "Epoch has not finished yet");
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

    /**
     * @notice Maximum allowable number of tokens in existence (claimed or unclaimed)
     */
    function _availableSupply() internal view returns (uint256) {
        uint256 newSupplyFromCurrentEpoch = (block.timestamp.sub(_startEpochTime)).mul(_rate);
        return _startEpochSupply.add(newSupplyFromCurrentEpoch);
    }

    /**
     * @notice Get timestamp of the current mining epoch start while simultaneously updating mining parameters
     * @return Timestamp of the current epoch
     */
    function _startEpochTimeWrite() internal returns (uint256) {
        uint256 startEpochTime = _startEpochTime;
        if (block.timestamp >= startEpochTime.add(RATE_REDUCTION_TIME)) {
            _updateMiningParameters();
            return _startEpochTime;
        }
        return startEpochTime;
    }

    function _updateMiningParameters() internal {
        uint256 inflationRate = _rate;
        uint256 startEpochSupply = _startEpochSupply.add(inflationRate.mul(RATE_REDUCTION_TIME));
        inflationRate = inflationRate.mul(RATE_DENOMINATOR).divDown(RATE_REDUCTION_COEFFICIENT);

        _miningEpoch = _miningEpoch.add(1);
        _startEpochTime = _startEpochTime.add(RATE_REDUCTION_TIME);
        _rate = inflationRate;
        _startEpochSupply = startEpochSupply;

        emit MiningParametersUpdated(inflationRate, startEpochSupply);
    }

    /**
     * @notice How much supply is mintable from start timestamp till end timestamp
     * @param start Start of the time interval (timestamp)
     * @param end End of the time interval (timestamp)
     * @return Tokens mintable from `start` till `end`
     */
    function _mintableInTimeframe(uint256 start, uint256 end) internal view returns (uint256) {
        require(start <= end, "start > end");

        uint256 currentEpochTime = _startEpochTime;
        uint256 currentRate = _rate;

        // It shouldn't be possible to over/underflow in here but we add checked maths to be safe

        // Special case if end is in future (not yet minted) epoch
        if (end > currentEpochTime.add(RATE_REDUCTION_TIME)) {
            currentEpochTime = currentEpochTime.add(RATE_REDUCTION_TIME);
            currentRate = currentRate.mul(RATE_DENOMINATOR).divDown(RATE_REDUCTION_COEFFICIENT);
        }

        require(end <= currentEpochTime.add(RATE_REDUCTION_TIME), "too far in future");

        uint256 toMint = 0;
        for (uint256 epoch = 0; epoch < 999; ++epoch) {
            if (end >= currentEpochTime) {
                uint256 currentEnd = end;
                if (currentEnd > currentEpochTime.add(RATE_REDUCTION_TIME)) {
                    currentEnd = currentEpochTime.add(RATE_REDUCTION_TIME);
                }

                uint256 currentStart = start;
                if (currentStart >= currentEpochTime.add(RATE_REDUCTION_TIME)) {
                    // We should never get here but what if...
                    break;
                } else if (currentStart < currentEpochTime) {
                    currentStart = currentEpochTime;
                }

                toMint = toMint.add(currentRate.mul(currentEnd.sub(currentStart)));

                if (start >= currentEpochTime) {
                    break;
                }
            }

            currentEpochTime = currentEpochTime.sub(RATE_REDUCTION_TIME);
            // double-division with rounding made rate a bit less => good
            currentRate = currentRate.mul(RATE_REDUCTION_COEFFICIENT).divDown(RATE_DENOMINATOR);
            assert(currentRate <= INITIAL_RATE);
        }

        return toMint;
    }

    // The below functions are duplicates of functions available above.
    // They are included for ABI compatibility with snake_casing as used in vyper contracts.
    // solhint-disable func-name-mixedcase

    function rate() external view override returns (uint256) {
        return _rate;
    }

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
        return _startEpochTimeWrite().add(RATE_REDUCTION_TIME);
    }

    /**
     * @notice Update mining rate and supply at the start of the epoch
     * @dev Callable by any address, but only once per epoch
     * Total supply becomes slightly larger if this function is called late
     */
    function update_mining_parameters() external {
        require(block.timestamp >= _startEpochTime.add(RATE_REDUCTION_TIME), "Epoch has not finished yet");
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
