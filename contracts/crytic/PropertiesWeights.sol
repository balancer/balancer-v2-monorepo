pragma solidity ^0.7.1;

import "../authorizer/Authorizer.sol";
import "../vault/Vault.sol";
import "../pools/constant-product/ConstantProductPool.sol";
import "../pools/IBPTPool.sol";
import "../test/TestToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract PropertiesWeights {
    Vault vault;
    uint256 poolsAdded = 0;
    constructor() public payable {
        address admin = address(3);
        Authorizer authorizer = new Authorizer(admin);
        vault = new Vault(authorizer);
    }

    function addConstantProductPool(
        uint256 initialBPT,
        uint256 amountA,
        uint256 amountB,
        uint256 weightA,
        uint256 weightB,
        uint256 swapFee
    ) external {
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = new TestToken("test token A", "TESTA", 18);
        tokens[1] = new TestToken("test token B", "TESTB", 18);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amountA;
        amounts[1] = amountB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = weightA;
        weights[1] = weightB;
        ConstantProductPool pool = new ConstantProductPool(
            vault,
            "test pool",
            "TEST_POOL",
            initialBPT,
            tokens,
            amounts,
            address(4),
            weights,
            swapFee
        );
        poolsAdded += 1;
    }
        
    function echidna_check_pool_count() external view returns (bool) {
        return vault.getNumberOfPools() == poolsAdded;
    }

    function echidna_sum_of_normalized_weights_equals_one() external view returns (bool) {
        uint256 numberOfPools = vault.getNumberOfPools();
        if (numberOfPools == 0) {
            return true;
        }
        bytes32[] memory poolIds = vault.getPoolIds(0, numberOfPools - 1);
        require(poolIds.length == numberOfPools);
        for (uint256 poolIndex = 0; poolIndex < poolIds.length; poolIndex++) {
            (address poolAddress, ) = vault.getPool(poolIds[poolIndex]);
            ConstantProductPool pool = ConstantProductPool(poolAddress);
            uint256 sumOfNormalizedWeights = 0;
            IERC20[] memory poolTokens = vault.getPoolTokens(poolIds[poolIndex]);
            for (uint256 tokenIndex = 0; tokenIndex < poolTokens.length; tokenIndex++) {
                sumOfNormalizedWeights += pool.getNormalizedWeight(poolTokens[tokenIndex]);
            }
            if (sumOfNormalizedWeights != 1 ether) {
                return false;
            }
        }
        return true;
    }
}