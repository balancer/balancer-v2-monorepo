// Factory interface to create pools of new issues for security token offerings
// (c) Kallol Borah, Verified Network, 2021

//"SPDX-License-Identifier: MIT"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import '@balancer-labs/v2-interfaces/contracts/vault/IVault.sol';
interface IPrimaryIssuePoolFactory {

    struct FactoryPoolParams{
        address security;
        address currency;
        uint256 minimumPrice;
        uint256 basePrice;
        uint256 maxAmountsIn;
        uint256 issueFeePercentage;
        uint256 cutOffTime;
    }

    function create(
        FactoryPoolParams memory params
    ) external returns (address);

}