// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.7.1;

import "../authorizer/Authorizer.sol";
import "../vault/Vault.sol";
import "../pools/weighted/WeightedPool.sol";
import "../vault/interfaces/IBasePool.sol";
import "../vault/interfaces/IAuthorizer.sol";
import "../test/TestToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract PropertiesWeights {
    Vault vault;
    uint256 poolsAdded = 0;
    bytes32[] private _poolIds;
    bytes32 private _lastPoolId;

    constructor() payable {
        address admin = address(3);
        Authorizer authorizer = new Authorizer(admin);
        vault = new Vault(IAuthorizer(address(authorizer)));
    }

    function addWeightedPool(
        address admin,
        uint256 amountA,
        uint256 amountB,
        uint256 weightA,
        uint256 weightB,
        uint256 swapFee
    ) external {
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = new TestToken(admin, "test token A", "TESTA", 18);
        tokens[1] = new TestToken(admin, "test token B", "TESTB", 18);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amountA;
        amounts[1] = amountB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = weightA;
        weights[1] = weightB;
        new WeightedPool(
            vault,
            "test pool",
            "TEST_POOL",
            tokens,
            weights,
            swapFee
        );
        poolsAdded += 1;
    }

    // There is no longer a way to get the number of pools from the vault (it is private)
    // Have to extract the nonce from the last pool id as a proxy
    function _getNumberOfPools() private view returns (uint256) {
        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        uint256 nonce = uint256(_lastPoolId) & (2**(10 * 8) - 1);

        return nonce + 1;
    }

    // No way to do this directly - need to store them as they're created
    function _getPoolIds(uint256 start, uint256 end) private view returns (bytes32[] memory) {
        bytes32[] memory poolIds = new bytes32[](end - start + 1);
        for (uint256 i = start; i <= end; i++) {
            poolIds[i] = _poolIds[i];
        }

        return poolIds;
    }

    function echidna_check_pool_count() external view returns (bool) {
        return _getNumberOfPools() == poolsAdded;
    }

    function echidna_sum_of_normalized_weights_equals_one() external view returns (bool) {
        uint256 numberOfPools = _getNumberOfPools();
        if (numberOfPools == 0) {
            return true;
        }
        bytes32[] memory poolIds = _getPoolIds(0, numberOfPools - 1);
        require(poolIds.length == numberOfPools);
         
        for (uint256 poolIndex = 0; poolIndex < poolIds.length; poolIndex++) {
            (address poolAddress, ) = vault.getPool(poolIds[poolIndex]);
            WeightedPool pool = WeightedPool(poolAddress);
            uint256[] memory normalizedWeights = pool.getNormalizedWeights();
            uint256 sumOfNormalizedWeights = 0;
            (IERC20[] memory poolTokens,) = vault.getPoolTokens(poolIds[poolIndex]);
            for (uint256 tokenIndex = 0; tokenIndex < poolTokens.length; tokenIndex++) {
                sumOfNormalizedWeights += normalizedWeights[tokenIndex];
            }
            if (sumOfNormalizedWeights != 1 ether) {
                return false;
            }
        }
        return true;
    }
}