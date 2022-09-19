// Implementation of pool for new issues of security tokens that allows price discovery
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../solidity-utils/openzeppelin/IERC20.sol";
import "../vault/IBasePool.sol";

interface IPrimaryPool is IBasePool {

    function getSecurity() external view returns (IERC20);

    function getCurrency() external view returns (IERC20);

    function getMinimumPrice() external view returns(uint256);

    function getMaximumPrice() external view returns(uint256);

    function getSecurityOffered() external view returns(uint256);

    function getIssueCutoffTime() external view returns(uint256);

    function getSecurityIndex() external view returns (uint256);

    function getCurrencyIndex() external view returns (uint256);

    function getBptIndex() external view returns (uint256);
    
}
