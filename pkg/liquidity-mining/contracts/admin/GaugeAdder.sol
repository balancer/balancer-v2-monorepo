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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeAdder.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakingLiquidityGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";

contract GaugeAdder is IGaugeAdder, SingletonAuthentication, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // "Ethereum" as bytes32.
    bytes32 private constant ETHEREUM = 0x457468657265756d000000000000000000000000000000000000000000000000;

    IGaugeController private immutable _gaugeController;
    IERC20 private immutable _balWethBpt;
    IAuthorizerAdaptorEntrypoint private _authorizerAdaptorEntrypoint;

    // Registered gauge types, stored as bytes32
    EnumerableSet.Bytes32Set private _gaugeTypes;

    // Mapping from gauge type to a list of address for approved factories for that type
    mapping(bytes32 => EnumerableSet.AddressSet) internal _gaugeFactoriesByType;

    // Mapping from gauge type to type number used by the gauge controller
    mapping(bytes32 => int128) _gaugeTypeNumber;


    constructor(IGaugeController gaugeController, IAuthorizerAdaptorEntrypoint authorizerAdaptorEntrypoint)
        SingletonAuthentication(gaugeController.admin().getVault())
    {
        _gaugeController = gaugeController;
        _authorizerAdaptorEntrypoint = authorizerAdaptorEntrypoint;

        // Cache the BAL 80 WETH 20 BPT on this contract.
        _balWethBpt = gaugeController.token();
    }

    /**
     * @notice Returns the address of the Authorizer adaptor entrypoint contract.
     */
    function getAuthorizerAdaptorEntrypoint() external view override returns (IAuthorizerAdaptorEntrypoint) {
        return _authorizerAdaptorEntrypoint;
    }

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view override returns (IGaugeController) {
        return _gaugeController;
    }

    function getGaugeTypes() external view returns (string[] memory) {
        uint256 gaugeTypesLength = getGaugeTypesCount();
        string[] memory gaugeTypes = new string[](gaugeTypesLength);

        for (uint256 i = 0; i < gaugeTypesLength; ++i) {
            gaugeTypes[i] = _bytes32ToString(_gaugeTypes.at(i));
        }

        return gaugeTypes;
    }

    function getGaugeTypeAtIndex(uint256 index) external view returns (string memory) {
        return _bytes32ToString(_gaugeTypes.at(index));
    }

    function getGaugeTypesCount() public view returns (uint256) {
        return _gaugeTypes.length();
    }

    function getGaugeTypeNumber(string memory gaugeType) external view returns (int128) {
        bytes32 gaugeTypeBytes = _validateAndCastGaugeType(gaugeType);
        return _gaugeTypeNumber[gaugeTypeBytes];
    }

    /**
     * @notice Returns the `index`'th factory for gauge type `gaugeType`
     */
    function getFactoryForGaugeType(string memory gaugeType, uint256 index) external view override returns (address) {
        bytes32 gaugeTypeBytes = _validateAndCastGaugeType(gaugeType);
        return _gaugeFactoriesByType[gaugeTypeBytes].at(index);
    }

    /**
     * @notice Returns the number of factories for gauge type `gaugeType`
     */
    function getFactoryCountForGaugeType(string memory gaugeType) external view override returns (uint256) {
        bytes32 gaugeTypeBytes = _validateAndCastGaugeType(gaugeType);
        return _gaugeFactoriesByType[gaugeTypeBytes].length();
    }

    /**
     * @notice Returns whether `gauge` has been deployed by one of the listed factories for the gauge type `gaugeType`
     */
    function isGaugeFromValidFactory(address gauge, string memory gaugeType) external view override returns (bool) {
        bytes32 gaugeTypeBytes = _validateAndCastGaugeType(gaugeType);
        return _isGaugeFromValidFactory(gauge, gaugeTypeBytes);
    }

    function _isGaugeFromValidFactory(address gauge, bytes32 gaugeType) internal view returns (bool) {
        EnumerableSet.AddressSet storage gaugeFactories = _gaugeFactoriesByType[gaugeType];
        uint256 gaugeFactoriesLength = gaugeFactories.length();

        // This potentially unbounded loop isn't an issue as the GaugeAdder may be redeployed
        // without affecting the rest of the system.
        for (uint256 i; i < gaugeFactoriesLength; ++i) {
            if (ILiquidityGaugeFactory(gaugeFactories.unchecked_at(i)).isGaugeFromFactory(gauge)) {
                return true;
            }
        }

        return false;
    }

    // Admin Functions

    function addGaugeType(string memory gaugeType, int128 typeNumber) external override authenticate {
        require(typeNumber >= 0, "Gauge type has to be greater than 0");
        require(typeNumber < _gaugeController.n_gauge_types(), "Gauge type number not present in gauge controller");
        bytes32 gaugeTypeBytes = _stringToBytes32(gaugeType); // Reverts if `gaugeType` does not fit in 32 bytes.

        require(_gaugeTypes.add(gaugeTypeBytes), "Gauge type already added");
        _gaugeTypeNumber[gaugeTypeBytes] = typeNumber;
    }

    function addGauge(address gauge, string memory gaugeType) external override authenticate {
        bytes32 gaugeTypeBytes = _validateAndCastGaugeType(gaugeType);

        if (gaugeTypeBytes == ETHEREUM) {
            IERC20 pool = IStakingLiquidityGauge(gauge).lp_token();
            require(pool != _balWethBpt, "Cannot add gauge for 80/20 BAL-WETH BPT");
        }

        _addGauge(gauge, gaugeTypeBytes);
    }

    /**
     * @notice Adds `factory` as an allowlisted factory contract for gauges with type `gaugeType`.
     */
    function addGaugeFactory(ILiquidityGaugeFactory factory, string memory gaugeType) external override authenticate {
        bytes32 gaugeTypeBytes = _validateAndCastGaugeType(gaugeType);

        // Sanity check that calling `isGaugeFromFactory` won't revert
        require(!factory.isGaugeFromFactory(address(0)), "Invalid factory implementation");

        EnumerableSet.AddressSet storage gaugeFactories = _gaugeFactoriesByType[gaugeTypeBytes];
        require(gaugeFactories.add(address(factory)), "Factory already added");

        emit GaugeFactoryAdded(gaugeType, factory);
    }

    // TODO: optional admin functions.

    function setGaugeTypeNumber(string memory gaugeType, int128 gaugeTypeNumber) external authenticate {
        // TODO: implement.
        // This would change the gauge type number for an existing gauge type.
    }

    function removeGaugeType(string memory gaugeType) external authenticate {
        // TODO: implement.
        // This would remove an existing gauge type.
        // It would not clear the existing factories.
    }

    // Internal functions

    /**
     * @dev Adds `gauge` to the GaugeController with type `gaugeType` and an initial weight of zero
     */
    function _addGauge(address gauge, bytes32 gaugeType) private {
        require(_isGaugeFromValidFactory(gauge, gaugeType), "Invalid gauge");
        int128 gaugeTypeNumber = _gaugeTypeNumber[gaugeType];

        // `_gaugeController` enforces that duplicate gauges may not be added so we do not need to check here.
        _authorizerAdaptorEntrypoint.performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.add_gauge.selector, gauge, gaugeTypeNumber)
        );
    }

    function _stringToBytes32(string memory str) internal pure returns (bytes32 bytesString) {
        require(bytes(str).length <= 32, "Input string should be 32 characters long at the most");

        assembly {
            bytesString := mload(add(str, 32))
        }
    }

    function _bytes32ToString(bytes32 _bytes32) internal pure returns (string memory) {
        bytes memory bytesArray = new bytes(32);
        for (uint256 i = 0; i < 32; ++i) {
            bytesArray[i] = _bytes32[i];
        }

        return string(bytesArray);
    }

    function _validateAndCastGaugeType(string memory gaugeType) internal view returns (bytes32 gaugeTypeBytes) {
        gaugeTypeBytes = _stringToBytes32(gaugeType);
        require(_gaugeTypes.contains(gaugeTypeBytes), "Invalid gauge type");
    }
}
