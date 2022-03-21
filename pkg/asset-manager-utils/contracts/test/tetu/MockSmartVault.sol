// SPDX-License-Identifier: ISC
/**
* By using this software, you understand, acknowledge and accept that Tetu
* and/or the underlying software are provided “as is” and “as available”
* basis and without warranties or representations of any kind either expressed
* or implied. Any use of this open source software released under the ISC
* Internet Systems Consortium license is done at your own risk to the fullest
* extent permissible pursuant to applicable law any and all liability as well
* as all warranties, including any fitness for a particular purpose with respect
* to Tetu and/or the underlying software and the use thereof are disclaimed.
*/

pragma solidity ^0.7.0;

import "./ISmartVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

contract MockSmartVault is ISmartVault {

    address underlying;

    constructor (address _underlying){
        underlying = _underlying;
    }

    function deposit(uint256 amount) external override {
        IERC20(underlying).transferFrom(address(msg.sender), address(this), amount);
    }

    function withdraw(uint256 numberOfShares) external override {
        IERC20(underlying).approve(address(msg.sender), numberOfShares);
        IERC20(underlying).transfer(address(msg.sender), numberOfShares);
    }

    function underlyingBalanceWithInvestmentForHolder(address holder) external override view returns (uint256){
        return IERC20(underlying).balanceOf(address(this));
    }

}
