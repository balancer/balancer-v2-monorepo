// Secondary issue pool interface 
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

interface IPrimaryIssuePool {

    function getPoolId() external returns(bytes32);

    function initialize() external;

    function getSecurity() external view returns (address);

    function getCurrency() external view returns (address);

    function getSecurityOffered() external view returns(uint256);

    function exit() external;

    function getOrderRef() external view returns(bytes32[] memory);

    function editOrder( bytes32 ref, uint256 _price, uint256 _qty) external;

    function cancelOrder(bytes32 ref) external;

    function getTrade(bytes32 ref) external view returns(uint256 b, uint256 a);

}

