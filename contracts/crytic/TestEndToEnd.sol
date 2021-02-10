// SPDX-License-Identifier: GPL-3.0-or-later

import "./interfaces.sol";
import "../authorizer/Authorizer.sol";
import "../vault/Vault.sol";
import "../pools/stable/StablePool.sol";
import "../pools/weighted/WeightedPool.sol";
import "../test/TestToken.sol";
import "../lib/math/FixedPoint.sol";

pragma solidity ^0.7.1;

contract TestEndToEnd is CryticInterface{
    using FixedPoint for uint256;

    function echidna_protocol_swap_fee_max() public view returns (bool) {
        uint256 _MAX_PROTOCOL_SWAP_FEE = FixedPoint.ONE.mul(50).div(100); // 0.5 (50%)
        (uint256 swapFee,,) = Vault(vault).getProtocolFees();
    
        return (swapFee <= _MAX_PROTOCOL_SWAP_FEE);
    } 
    function echidna_protocol_flash_loan_fee_max() public view returns (bool) {
        uint256 _MAX_PROTOCOL_FLASH_LOAN_FEE = FixedPoint.ONE.mul(50).div(100); // 0.5 (50%)
       (,, uint256 flashLoanFee) = Vault(vault).getProtocolFees();

        return (flashLoanFee <= _MAX_PROTOCOL_FLASH_LOAN_FEE);
    } 
    function echidna_protocol_withdraw_fee_max() public view returns (bool) {
        uint256 _MAX_PROTOCOL_WITHDRAW_FEE = FixedPoint.ONE.mul(2).div(100); // 0.02 (2%)
       (,uint256 withdrawFee,) = Vault(vault).getProtocolFees();

        return (withdrawFee <= _MAX_PROTOCOL_WITHDRAW_FEE);
    } 
}
