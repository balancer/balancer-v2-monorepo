// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;


contract CustomFeeAuthorizer {
    event feeSetterAdded(address indexed feeSetter);
    event feeSetterRemoved(address indexed feeSetter);

    mapping(address => bool) private isCustomFeeSetter;
    bool public isCustomFeeEnabled = false ;
    address public solver;

    function canSetCustomFee(address _setterAddress) public view returns(bool _isAuth){
        if(isCustomFeeEnabled){
            _isAuth = (isCustomFeeSetter[_setterAddress] ||  solver == _setterAddress) ;
        }else{
        _isAuth = false;
        }
    }

    function addCustomFeeSetter(address _toAdd) onlySolver public {
        require(_toAdd != address(0));
        require(isCustomFeeEnabled,"Custom Fee Not Enabled");
        isCustomFeeSetter[_toAdd] = true;
        emit feeSetterAdded(_toAdd);
    }

    function removeCustomFeeSetter(address _toRemove) onlySolver public {
        require(_toRemove != msg.sender);
        isCustomFeeSetter[_toRemove] = false;
        emit feeSetterRemoved(_toRemove);
    }

    function enableCustomFee() onlySolver() internal {
        require(!isCustomFeeEnabled, "Already Enabled");
        isCustomFeeEnabled = true;
    }

    function _setSolverAddress(address _solver) internal {
        require(_solver != address(0));
        solver = _solver;
    }

    modifier onlySolver() {
        require(solver == msg.sender,'CALLER_IS_NOT_SOLVER');
        _;
    }


}