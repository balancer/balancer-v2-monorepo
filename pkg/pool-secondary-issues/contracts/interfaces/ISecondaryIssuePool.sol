// Secondary issue pool interface 
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

interface ISecondaryIssuePool {

    function getPoolId() external view returns(bytes32);
    
    function getSecurity() external view returns (address);

    function getCurrency() external view returns (address);

    function getSecurityOffered() external view returns(uint256);
}

