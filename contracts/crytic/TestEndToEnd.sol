
import "./interfaces.sol";
import "../authorizer/Authorizer.sol";
import "../vault/Vault.sol";
import "../pools/stablecoin/StablecoinPool.sol";
import "../pools/constant-product/ConstantProductPool.sol";
import "../test/TestToken.sol";
import "../math/FixedPoint.sol";

contract TestEndToEnd is CryticInterface{
    using FixedPoint for uint128;

    function echidna_protocol_swap_fee_max() public view returns (bool) {
        uint128 _MAX_PROTOCOL_SWAP_FEE = FixedPoint.ONE.mul128(50).div128(100); // 0.5 (50%)
        return (Vault(vault).getProtocolSwapFee() <= _MAX_PROTOCOL_SWAP_FEE);
    } 
    function echidna_protocol_flash_loan_fee_max() public view returns (bool) {
        uint256 _MAX_PROTOCOL_FLASH_LOAN_FEE = FixedPoint.ONE.mul128(50).div128(100); // 0.5 (50%)
        return (Vault(vault).getProtocolFlashLoanFee() <= _MAX_PROTOCOL_FLASH_LOAN_FEE);
    } 
    function echidna_protocol_withdraw_fee_max() public view returns (bool) {
        uint128 _MAX_PROTOCOL_WITHDRAW_FEE = FixedPoint.ONE.mul128(2).div128(100); // 0.02 (2%)
        return (Vault(vault).getProtocolFlashLoanFee() <= _MAX_PROTOCOL_WITHDRAW_FEE);
    } 
}
