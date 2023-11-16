// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";

contract CustomFeeAuthorizer is Ownable {
    event authorizorAdded(address indexed _authorizor);
    event authorizorRemoved(address indexed _authorizor);

    mapping(address => bool) private authorized;
    bool public isCustomFeeEnabled = false;

    function isCustomFeeAuthorised(address _authAdd) public view returns(bool _isAuth){
        if(isCustomFeeEnabled){
            _isAuth = (authorized[_authAdd] ||  owner() == _authAdd) ;
        }else{
        _isAuth = false;
        }
    }

    function addAuthorized(address _toAdd) onlyOwner public {
        require(_toAdd != address(0));
        require(isCustomFeeEnabled,"Custom Fee Not Enabled");
        authorized[_toAdd] = true;
        emit authorizorAdded(_toAdd);
    }

    function removeAuthorized(address _toRemove) onlyOwner public {
        require(_toRemove != msg.sender);
        authorized[_toRemove] = false;
        emit authorizorRemoved(_toRemove);
    }

    function enableCustomFee() onlyOwner() internal {
        require(!isCustomFeeEnabled, "Already Enabled");
        isCustomFeeEnabled = true;
    }


}