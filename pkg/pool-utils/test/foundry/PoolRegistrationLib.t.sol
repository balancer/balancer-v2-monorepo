// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "@balancer-labs/v2-vault/contracts/Vault.sol";

import "../../contracts/lib/PoolRegistrationLib.sol";

contract PoolRegistrationLibTest is Test {
    IVault private _vault;

    function setUp() external {
        _vault = new Vault(IAuthorizer(0), IWETH(0), 0, 0);
    }

    function testPositionZeroTokenFixed(uint8[10] memory tokenIds) external {
        IERC20 bpt = IERC20(address(this));

        IERC20[] memory tokens = new IERC20[](10);
        for (uint256 i = 0; i < tokens.length; i++) {
            tokens[i] = IERC20(i + 1);
        }
        address[] memory assetManagers = new address[](10);

        bytes32 poolId = PoolRegistrationLib.registerComposablePool(
            _vault,
            IVault.PoolSpecialization.GENERAL,
            tokens,
            assetManagers
        );

        for (uint256 i = 0; i < tokenIds.length; i++) {
            IERC20 token = IERC20(bound(tokenIds[i], 1, 10));
            (IERC20[] memory poolTokens, , ) = _vault.getPoolTokens(poolId);

            for (uint256 j = 0; j < poolTokens.length; j++) {
                if (token == poolTokens[j]) {
                    // If the token is already registered then deregister it.
                    PoolRegistrationLib.deregisterToken(_vault, poolId, token);
                    break;
                } else if (j == poolTokens.length - 1) {
                    // If the token isn't registered then register it.
                    PoolRegistrationLib.registerToken(_vault, poolId, token, address(0));
                }
            }

            assertTrue(poolTokens[0] == bpt);
        }
    }
}
