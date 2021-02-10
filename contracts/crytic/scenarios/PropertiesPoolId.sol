// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.7.1;

contract PropertiesPoolId {
    enum PoolOptimization { STANDARD, SIMPLIFIED_QUOTE, TWO_TOKEN }

    function _toPoolId(
        address pool,
        PoolOptimization optimization,
        uint80 nonce
    ) internal pure returns (bytes32) {
        uint256 serialized;

        // | 10 bytes nonce | 2 bytes optimization setting | 20 bytes pool address |
        serialized |= uint256(nonce) << (22 * 8);
        serialized |= uint256(optimization) << (20 * 8);
        serialized |= uint256(pool);

        return bytes32(serialized);
    }
    function _getPoolData(bytes32 poolId) internal pure returns (address, PoolOptimization) {
        // | 10 bytes nonce | 2 bytes optimization setting | 20 bytes pool address |
        address pool = address(uint256(poolId) & (2**(20 * 8) - 1));
        PoolOptimization optimization = PoolOptimization(uint256(poolId >> (20 * 8)) & (2**(2 * 8) - 1));

        return (pool, optimization);
    }
    function assert_pool_valid(address pool, uint256 opt, uint80 nonce) public pure {
        require(pool!= address(0));
        PoolOptimization enumOptimization;

        opt = uint256(opt) % 3;
        if (opt == 0) enumOptimization = PoolOptimization.STANDARD;
        else if (opt == 1) enumOptimization = PoolOptimization.SIMPLIFIED_QUOTE;
        else if (opt == 2) enumOptimization = PoolOptimization.TWO_TOKEN;

        bytes32 poolId = _toPoolId(pool, enumOptimization, nonce);
        (address poolA, PoolOptimization po) = _getPoolData(poolId);
        assert(poolA == pool);
        assert(po == enumOptimization);
    }
}