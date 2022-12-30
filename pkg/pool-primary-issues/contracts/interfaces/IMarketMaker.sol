// Verified Asset manager interface for Balancer security token pool
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

interface IMarketMaker {

    function subscribe(bytes32 poolId, address security, address assetIn, string calldata assetName, uint256 amount, address investor, uint256 price, bool paidIn) external;

}