# Setup 

## E2E Testing

To run the end-to-end initialization, different branches of the repository needs to be setup prior:

1. Install [echidna from `dev-auto` branch](https://github.com/crytic/echidna/tree/dev-auto#installation).
    - For Mac OS X, [binaries are available here](https://github.com/crytic/echidna/actions/runs/521182645#artifacts)
2. Install [etheno from `dev-ganache-improvements` branch](https://github.com/crytic/etheno/tree/dev-ganache-improvements).

##  Non E2E Properties 

For all other properties, the normal version of Echidna can be used. 

Install [Echidna via the steps outlined here.](https://github.com/crytic/echidna#installation)

## How to seed test file with Echidna for E2E Testing

Prior to running Echidna properties, we need to capture the deployment of a Balancer vault with pools and useful calls to seed the Echidna corpus. [VaultSetup](test/crytic/VaultSetup.ts) was created for a vault with 2 pools with everything setup. In theory, any other test file can be used for the seeding.

### Initial Echidna Setup

This is used to generate the deterministic `Vault.json` that is used to seed the deployments Echidna relies on

1. Run `npx hardhat clean && npx hardhat compile`
2. Run `etheno --ganache --ganache-args "--gasLimit=0x1fffffffffffff --allowUnlimitedContractSize -e 1000000000" -x ./contracts/crytic/Vault.json`
3. In another terminal, run `./node_modules/.bin/hardhat test --network localhost test/crytic/CryticInvestmentManager.ts`
4. Kill Etheno when the testing finishes (via Ctrl+C)
5. Then, run `echidna-test . --contract TestE2E --config contracts/crytic/TestE2E.yaml`

## Properties

### General End to End Properties

`echidna-test . --contract TestEndToEnd --config contracts/crytic/TestEndToEnd.yaml`
| ID | Description | Name | Contract | Result |
|----|-------------|------|----------|--------|
| 1 | Protocol swap fee cannot exceed maximum | [`echidna_protocol_swap_fee_max`](contracts/crytic/TestEndToEnd.sol#L13-L15) | TestEndToEnd.sol | PASSED |
| 2 | Protocol flash loan fee cannot exceed maximum | [`echidna_protocol_flash_loan_fee_max`](contracts/crytic/TestEndToEnd.sol#L17-L19) | TestEndToEnd.sol | PASSED |
| 3 | Protocol withdrawal fee cannot exceed maximum | [`echidna_protocol_withdraw_fee_max`](contracts/crytic/TestEndToEnd.sol#L21-L23) | TestEndToEnd.sol | PASSED |

### Scenario Based Properties

`echidna-test . --contract TestScenario --config contracts/crytic/TestScenario.yaml`
| ID | Description | Name | Contract | Result |
|----|-------------|------|----------|--------|
| 4 | Calling `joinPoolTokenInForExactBPTOut` does not lead to free BPT tokens | [`exploit_joinPoolTokenInForExactBPTOut`](contracts/crytic/scenarios/PropertiesJoinExit.sol#L26-L37) | PropertiesJoinExit.sol | FAILED (TOB-BALANCER-006) |
| 5 | Calling `exitPoolBPTInForExactTokensOut` does not lead to free BPT token | [`exploit_exitPoolBPTInForExactTokensOut`](contracts/crytic/scenarios/PropertiesJoinExit.sol#L80-L109) | PropertiesJoinExit.sol | FAILED (TOB-BALANCER-007) |
| 6 | Calling `_inGivenOut` always returns positive non-zero root | [`in_given_out_positive_root`](contracts/crytic/scenarios/PropertiesStablecoinMath.sol#L129-L143) | PropertiesStablecoinMath.sol | PASSED |
| 7 | Calling `_outGivenIn` always returns positive non-zero root | [`out_given_in_positive_root`](contracts/crytic/scenarios/PropertiesStablecoinMath.sol#L184-L197)  | PropertiesStablecoinMath.sol | PASSED |
| 8 |  Calling calculateOneTokenSwapFee always returns positive non-zero root | [`one_token_swap_positive_root`](contracts/crytic/scenarios/PropertiesStablecoinMath.sol#L45-L55) | PropertiesStablecoinMath.sol | PASSED |
| 9 | Invariant is always positive and non-zero | [`invariant_positive`](contracts/crytic/scenarios/PropertiesStablecoinMath.sol#L241-L250) | PropertiesStablecoinMath.sol | FAILED (TOB-BALANCER-014) |
| 10 | Rounding in `_inGivenOut` does not lead to free swap | [`exploit_in_given_out`](contracts/crytic/scenarios/PropertiesSwap.sol#L66-L75) | TestScenario.sol | FAILED (TOB-BALANCER-011, TOB-BALANCER-012) |
| 11 | Rounding in `_outGivenIn` does not lead to free swap | [`exploit_out_given_in`](contracts/crytic/scenarios/PropertiesSwap.sol#L52-L64)
| 12 | _getPoolData should return same pool address and optimization as _toPoolId | [`assert_valid_pool_id`](contracts/crytic/scenarios/PropertiesPoolId.sol#L27-L40) | PropertiesPoolId | PASSED | 
| 13 | Difference between randomly calculating token swap fee is less than 1 ether slippage | [`test_calculate_fee_difference`](contracts/crytic/scenarios/PropertiesStablecoinMath.sol#L66-L86) | PropertiesStablecoinMath.sol | PASSED |

### Property Weights 
`echidna-test . --contract PropertiesWeights --config contracts/crytic/property-weights.yaml`

| ID | Description | Name | Contract | Result |
|----|-------------|------|----------|--------|
| 14 | Sum of normalized weights is 1 | [`echidna_sum_of_normalized_weights_equals_one`](contracts/crytic/PropertiesWeights.sol#L55-#L75) | PropertiesWeights | PASSED |

### PropertiesBPTToken

`echidna-test . --contract TestBPTTokenTransferable --config contracts/crytic/TestBPTTokenTransferable.yaml`

| ID | Description | Name | Contract | Result |
|----|-------------|------|----------|--------|
| 15 | Transfering tokens to `address(0)` causes a revert | [`transfer_to_zero`](contracts/crytic/token/PropertiesBPTToken.sol#L27-L32) and [`transferFrom`](contracts/crytic/token/PropertiesBPTToken.sol#L34-L41) | TestBPTTokenTransferable | PASSED |
| 16 | Null address owns no tokens | [`zero always empty`](contracts/crytic/token/PropertiesBPTToken.sol#L9-L11) | TestBPTTokenTransferable | FAILED (TOB-BALANCER-003) |
| 17 | Transfer valid amount of tokens to non-null address reduces balance | [`transferFrom_to_other`](contracts/crytic/token/PropertiesBPTToken.sol#L50-L59) and [`transfer_to_other`](contracts/crytic/token/PropertiesBPTToken.sol#L67-L78) | TestBPTTokenTransferable | PASSED |
| 18 | Transfer invalid amount of tokens to non-null address reverts or returns false | [`transfer_to_user`](contracts/crytic/token/PropertiesBPTToken.sol#L80-L86) | TestBPTTokenTransferable | PASSED |
| 19 | Self-transfer valid amount of tokens keeps current balance constant | [`self_transferFrom`](contracts/crytic/token/PropertiesBPTToken.sol#L43-L48) and [`self.transfer`](contracts/crytic/token/PropertiesBPTToken.sol#L50-L59) | TestBPTTokenTransferable | PASSED |
| 20 | Approving overwrites the previous allowance value | [`approve_overwrites`](contracts/crytic/token/PropertiesBPTToken.sol#L12-L19) | TestBPTTokenTransferable | PASSED |
| 21 | Balances are consistent with total supply | [`totalSupply_consistent`](contracts/crytic/token/PropertiesBPTToken.sol#L23-L25) and [`balance_less_than_totalSupply`](contracts/crytic/token/PropertiesBPTToken.sol#L20-L22) | TestBPTTokenTransferable | PASSED |


### Arithmetic

`echidna-test . --contract TestArithmetic --config contracts/crytic/TestArithmetic.yaml`

| ID | Description | Name | Contract | Result |
|----|-------------|------|----------|--------|
| 22 | Subtraction identity - `x1 - 0 = x1` | [`echidna_sub128_zero_identity`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L32-L35) and [`echidna_sub256_zero_identity`](contracts/crytic/TBFixedPoint256.sol#L42-L45) | TestArithmetic.sol | PASSED |
| 23 | Subtraction self is zero - `x1 - x1 = 0` | [`echidna_sub128_self`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L37-L40) and [`echidna_sub256_self`](contracts/crytic/TBFixedPoint256.sol#L47-L50) | TestArithmetic.sol | PASSED |
| 24 | Addition is commutative - `x1 + x2 = x2 + x1` |[`echidna_add128_commutative`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L42-L50) and [`echidna_add256_commutative`](contracts/crytic/TBFixedPoint256.sol#L52-L60) | TestArithmetic.sol | PASSED |
| 25 | Addition is associative - `x1 + (x2 + x3) = (x1 + x2) + x3` | [`echidna_add128_associative`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L52-L60) and [`echidna_add256_associative`](contracts/crytic/TBFixedPoint256.sol#L62-L70) | TestArithmetic.sol | PASSED |
| 26 | Addition identity - `x1 + 0 = x1` | [`echidna_add128_zero_identity`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L62-L65) and [`echidna_add256_zero_identity`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L72-L75) | TestArithmetic.sol | PASSED |
| 27 | Multiplication by 0 - `x1 * 0 = 0` | [`echidna_mul128_zero`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L67-L70) and [`echidna_mul256_zero`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L77-L80) | TestArithmetic.sol | PASSED |
| 28 | Multiplication is commutative - `x1 * x2 = x2 * x1` | [`echidna_mul128_commutative`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L72-L80) and [`echidna_mul256_commutative`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L82-L90) | TestArithmetic.sol | PASSED |
| 29 | Multiplication Identity - `x1 * 1 = x1` | [`echidna_mul128_one`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L82-L85) and [`echidna_mul256_one`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L92-L95) | TestArithmetic.sol | FAILED (TOB-BALANCER-005)|
| 30 | Multiplication is 2*add - `2 * x1 = x1 + x1` | [`echidna_mul128_is_2add`](contracts/crytic/arithmetic/TBFixedPoint128.sol#L87-L91) and [`echidna_mul256_is_2add`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L97-L101) | TestArithmetic.sol | FAILED (TOB-BALANCER-005) |
| 31 | Power is 2*mul - `x1 ^ 2 = x1 * x1` | [`echidna_powi_mul2`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L103-L110) | TestArithmetic.sol | FAILED (TOB-BALANCER-007) |
| 32 | Power is 3*mul - `x1 ^ 2 = x1 * x2 * x1` | [`echidna_powi_mul3`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L112-L119) | TestArithmetic.sol | PASSED
| 33 | Square root precision | [`echidna_sqrt_precision`](contracts/crytic/arithmetic/TBFixedPoint256.sol#L130-L143) | TestArithmetic.sol | FAILED (TOB-BALANCER-016) |
| 34 | Exponential and logarithmic are inverse functions of each other with 10**2 delta | [`echidna_log_of_exp_of_x_equals_x`](contracts/crytic/arithmetic/TBLogExpMath.sol#L24-L39) and [`echidna_exp_of_log_of_x_equals_x`](contracts/crytic/arithmetic/TBLogExpMath.sol#L42-L63) | TestArithmetic.sol | FAILED (TOB-BALANCER-011) | 
