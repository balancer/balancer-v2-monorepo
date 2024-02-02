// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

contract CustomFeeAuthorizer {
    event FeeSetterAdded(address indexed feeSetter);
    event FeeSetterRemoved(address indexed feeSetter);

    mapping(address => bool) private _isCustomFeeSetter;
    bool public isCustomFeeEnabled = false;
    address public solver;

    function canSetCustomFee(address setterAddress) public view returns (bool isAuthorized) {
        if (isCustomFeeEnabled) {
            isAuthorized = (_isCustomFeeSetter[setterAddress] || solver == setterAddress);
        } else {
            isAuthorized = false;
        }
    }

    function addCustomFeeSetter(address newCustomFeeSetter) public onlySolver {
        _require(newCustomFeeSetter != address(0), Errors.INVALID_INPUT_ADDRESS);
        _require(isCustomFeeEnabled, Errors.FEATURE_DISABLED);
        _isCustomFeeSetter[newCustomFeeSetter] = true;
        emit FeeSetterAdded(newCustomFeeSetter);
    }

    function removeCustomFeeSetter(address customFeeSetter) public onlySolver {
        _require(customFeeSetter != msg.sender, Errors.SENDER_NOT_ALLOWED);
        _isCustomFeeSetter[customFeeSetter] = false;
        emit FeeSetterRemoved(customFeeSetter);
    }

    function _enableCustomFee() internal onlySolver {
        require(!isCustomFeeEnabled, "Already Enabled");
        isCustomFeeEnabled = true;
    }

    function _setSolverAddress(address _solver) internal {
        _require(_solver != address(0), Errors.INVALID_INPUT_ADDRESS);
        solver = _solver;
    }

    modifier onlySolver() {
        _require(solver == msg.sender, Errors.SENDER_NOT_ALLOWED);
        _;
    }
}
