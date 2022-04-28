// Primary issue pool interface 
// (c) Kallol Borah, Verified Network, 2021
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

interface IPrimaryIssuePool {

    function getPoolId() external returns(bytes32);

    function initialize() external;

    function getSecurity() external view returns (address);

    function getCurrency() external view returns (address);

    function exit() external;

}

