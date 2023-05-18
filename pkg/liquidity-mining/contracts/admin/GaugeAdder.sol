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
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";

contract GaugeAdder is IGaugeAdder, SingletonAuthentication, ReentrancyGuard {
    // "Ethereum" string abi encoded and hashed.
    bytes32 private constant _ETHEREUM = 0x564ccaf7594d66b1eaaea24fe01f0585bf52ee70852af4eac0cc4b04711cd0e2;
    int128 private constant _ETHEREUM_TYPE_GAUGE = 2;

    IGaugeController private immutable _gaugeController;
    IERC20 private immutable _balWethBpt;
    IAuthorizerAdaptorEntrypoint private _authorizerAdaptorEntrypoint;

    // Registered gauge types
    string[] private _gaugeTypes;

    // Mapping from gauge type to address of approved factory for that type
    mapping(string => ILiquidityGaugeFactory) private _gaugeTypeFactory;

    constructor(IGaugeController gaugeController, IAuthorizerAdaptorEntrypoint authorizerAdaptorEntrypoint)
        SingletonAuthentication(gaugeController.admin().getVault())
    {
        _gaugeController = gaugeController;
        _authorizerAdaptorEntrypoint = authorizerAdaptorEntrypoint;

        // Cache the BAL 80 WETH 20 BPT on this contract.
        _balWethBpt = gaugeController.token();
    }

    /// @inheritdoc IGaugeAdder
    function getAuthorizerAdaptorEntrypoint() external view override returns (IAuthorizerAdaptorEntrypoint) {
        return _authorizerAdaptorEntrypoint;
    }

    /// @inheritdoc IGaugeAdder
    function getGaugeController() external view override returns (IGaugeController) {
        return _gaugeController;
    }

    /// @inheritdoc IGaugeAdder
    function getGaugeTypes() external view override returns (string[] memory) {
        return _gaugeTypes;
    }

    /**
     * @notice Returns gauge type name registered at the given index.
     */
    function getGaugeTypeAtIndex(uint256 index) external view returns (string memory) {
        return _gaugeTypes[index];
    }

    /**
     * @notice Returns gauge types total.
     */
    function getGaugeTypesCount() public view returns (uint256) {
        return _gaugeTypes.length;
    }

    /// @inheritdoc IGaugeAdder
    function getFactoryForGaugeType(string memory gaugeType) public view override returns (ILiquidityGaugeFactory) {
        require(_isValidGaugeType(gaugeType), "Invalid gauge type");
        return _gaugeTypeFactory[gaugeType];
    }

    /// @inheritdoc IGaugeAdder
    function isGaugeFromValidFactory(address gauge, string memory gaugeType) external view override returns (bool) {
        require(_isValidGaugeType(gaugeType), "Invalid gauge type");
        return _isGaugeFromValidFactory(gauge, gaugeType);
    }

    // Admin Functions

    /// @inheritdoc IGaugeAdder
    function addGaugeType(string memory gaugeType) external override authenticate {
        uint256 gaugeTypeLength = bytes(gaugeType).length;
        require(
            gaugeTypeLength > 0 && gaugeTypeLength <= 32,
            "Input string should be between 1 and 32 characters long"
        );
        require(!_isValidGaugeType(gaugeType), "Gauge type already added");

        _gaugeTypes.push(gaugeType);

        emit GaugeTypeAdded(gaugeType, gaugeType, _ETHEREUM_TYPE_GAUGE);
    }

    /// @inheritdoc IGaugeAdder
    function addGauge(address gauge, string memory gaugeType) external override authenticate {
        require(_isValidGaugeType(gaugeType), "Invalid gauge type");

        if (keccak256(abi.encodePacked(gaugeType)) == _ETHEREUM) {
            IERC20 pool = IStakingLiquidityGauge(gauge).lp_token();
            require(pool != _balWethBpt, "Cannot add gauge for 80/20 BAL-WETH BPT");
        }

        _addGauge(gauge, gaugeType);
    }

    /// @inheritdoc IGaugeAdder
    function setGaugeFactory(ILiquidityGaugeFactory factory, string memory gaugeType) external override authenticate {
        require(_isValidGaugeType(gaugeType), "Invalid gauge type");

        // Sanity check that calling `isGaugeFromFactory` won't revert
        require(!factory.isGaugeFromFactory(address(0)), "Invalid factory implementation");

        _gaugeTypeFactory[gaugeType] = factory;

        emit GaugeFactorySet(gaugeType, gaugeType, factory);
    }

    // Internal functions

    function _isGaugeFromValidFactory(address gauge, string memory gaugeType) internal view returns (bool) {
        ILiquidityGaugeFactory gaugeFactory = _gaugeTypeFactory[gaugeType];
        return gaugeFactory == ILiquidityGaugeFactory(0) ? false : gaugeFactory.isGaugeFromFactory(gauge);
    }

    /**
     * @dev Adds `gauge` to the GaugeController with type `gaugeType` and an initial weight of zero
     */
    function _addGauge(address gauge, string memory gaugeType) private {
        require(_isGaugeFromValidFactory(gauge, gaugeType), "Invalid gauge");

        // `_gaugeController` enforces that duplicate gauges may not be added so we do not need to check here.
        _authorizerAdaptorEntrypoint.performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.add_gauge.selector, gauge, _ETHEREUM_TYPE_GAUGE)
        );
    }

    function _isValidGaugeType(string memory gaugeType) internal view returns (bool) {
        bytes32 gaugeTypeHash = keccak256(abi.encodePacked(gaugeType));
        for (uint256 i = 0; i < _gaugeTypes.length; ++i) {
            if (gaugeTypeHash == keccak256(abi.encodePacked(_gaugeTypes[i]))) {
                return true;
            }
        }

        return false;
    }
}
