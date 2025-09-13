// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import { console } from "forge-std/console.sol";
import { Test } from "forge-std/Test.sol";

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/MockBasicAuthorizer.sol";
import "@balancer-labs/v2-pool-weighted/contracts/test/MockWeightedPool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-pool-weighted/contracts/WeightedPool.sol";
import "@balancer-labs/v2-pool-utils/contracts/test/MockVault.sol";

import "../../contracts/ProtocolFeePercentagesProvider.sol";
import "../../contracts/PoolSwapFeeHelper.sol";

contract PoolSwapFeeHelperTest is Test {
    address constant DELEGATE_OWNER = 0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B;
    bytes32 constant ANY_POOL_ID = bytes32(uint256(0xdeadbeef));

    uint256 constant DEFAULT_SWAP_FEE_PERCENTAGE = 1e16;
    uint256 constant NEW_SWAP_FEE_PERCENTAGE = 5e16;
    uint256 constant DEFAULT_BALANCE = 100e18;
    uint256 constant MAX_PROTOCOL_FEE = 10e16;

    address private admin;

    // Default user.
    address payable internal alice;
    uint256 internal aliceKey;
    // Default counterparty.
    address payable internal bob;
    uint256 internal bobKey;

    address payable internal lp;
    uint256 internal lpKey;

    ProtocolFeePercentagesProvider private protocolFeeProvider;
    MockBasicAuthorizer private authorizer;
    MockWeightedPool private testPool;
    MockVault private vault;

    PoolSwapFeeHelper internal poolHelper;

    IERC20[] internal tokens;
    uint256[] internal weights;

    uint256 internal alicePoolSetId;
    uint256 internal bobPoolSetId;

    // Have to redeclare events here because 0.7.
    event PoolSetCreated(uint256 indexed poolSetId, address indexed initialManager);
    event PoolSetDestroyed(uint256 indexed poolSetId, address indexed manager);
    event PoolAddedToSet(bytes32 indexed poolId, uint256 indexed poolSetId);
    event PoolRemovedFromSet(bytes32 indexed poolId, uint256 indexed poolSetId);
    event PoolSetOwnershipTransferred(
        uint256 indexed poolSetId,
        address indexed oldManager,
        address indexed newManager
    );

    function setUp() external {
        authorizer = new MockBasicAuthorizer();
        admin = authorizer.getRoleMember(authorizer.DEFAULT_ADMIN_ROLE(), 0);

        vault = new MockVault(authorizer);
        protocolFeeProvider = new ProtocolFeePercentagesProvider(
            IVault(address(vault)),
            MAX_PROTOCOL_FEE,
            MAX_PROTOCOL_FEE
        );

        weights = new uint256[](2);
        weights[0] = 50e16;
        weights[1] = 50e16;

        tokens = new IERC20[](2);
        tokens[0] = new TestToken("Test A", "TEST-A", 18);
        tokens[1] = new TestToken("Test B", "TEST-B", 18);

        testPool = new MockWeightedPool(
            WeightedPool.NewPoolParams({
                name: "Weighted Pool",
                symbol: "TEST",
                tokens: tokens,
                normalizedWeights: weights,
                rateProviders: new IRateProvider[](tokens.length),
                assetManagers: new address[](tokens.length),
                swapFeePercentage: DEFAULT_SWAP_FEE_PERCENTAGE
            }),
            IVault(address(vault)),
            IProtocolFeePercentagesProvider(address(protocolFeeProvider)),
            90 days,
            30 days,
            DELEGATE_OWNER
        );

        (alice, aliceKey) = createUser("alice");
        (bob, bobKey) = createUser("bob");
        (lp, lpKey) = createUser("lp");

        poolHelper = new PoolSwapFeeHelper(IVault(address(vault)), admin);

        // Grant permission to pool helper.
        bytes32 setSwapFeeAction = testPool.getActionId(BasePool.setSwapFeePercentage.selector);
        authorizer.grantRole(setSwapFeeAction, address(poolHelper));

        vm.startPrank(admin);
        alicePoolSetId = poolHelper.createPoolSet(alice);
        bobPoolSetId = poolHelper.createPoolSet(bob);
        vm.stopPrank();
    }

    /// @dev Generates a user, labels its address, and funds it with test assets.
    function createUser(string memory name) internal returns (address payable, uint256) {
        (address user, uint256 key) = makeAddrAndKey(name);
        vm.label(user, name);
        vm.deal(payable(user), DEFAULT_BALANCE);

        for (uint256 i = 0; i < tokens.length; ++i) {
            deal(address(tokens[i]), user, DEFAULT_BALANCE);
        }

        return (payable(user), key);
    }

    // creates a labeled address and the corresponding private key
    function makeAddrAndKey(string memory name) internal override returns (address addr, uint256 privateKey) {
        privateKey = uint256(keccak256(abi.encodePacked(name)));
        addr = vm.addr(privateKey);
        vm.label(addr, name);
    }

    function testAddPoolsWithTwoBatches() public {
        assertEq(poolHelper.getPoolCountForSet(alicePoolSetId), 0, "Initial pool count non-zero");

        // Add first batch of pools
        bytes32[] memory firstPoolIds = _generatePools(10);
        for (uint256 i = 0; i < firstPoolIds.length; i++) {
            vm.expectEmit();
            emit PoolAddedToSet(firstPoolIds[i], alicePoolSetId);
        }

        vm.prank(admin);
        poolHelper.addPoolsToSet(alicePoolSetId, firstPoolIds);

        assertEq(poolHelper.getPoolCountForSet(alicePoolSetId), firstPoolIds.length, "Pools count should be 10");
        for (uint256 i = 0; i < firstPoolIds.length; i++) {
            assertTrue(poolHelper.isPoolInSet(firstPoolIds[i], alicePoolSetId));
        }

        // Add second batch of pools
        bytes32[] memory secondPoolIds = _generatePools(10);
        for (uint256 i = 0; i < secondPoolIds.length; i++) {
            vm.expectEmit();
            emit PoolAddedToSet(secondPoolIds[i], alicePoolSetId);
        }

        vm.prank(admin);
        poolHelper.addPoolsToSet(alicePoolSetId, secondPoolIds);
        assertEq(
            poolHelper.getPoolCountForSet(alicePoolSetId),
            firstPoolIds.length + secondPoolIds.length,
            "Pools count should be 20"
        );

        for (uint256 i = 0; i < secondPoolIds.length; i++) {
            assertTrue(poolHelper.isPoolInSet(secondPoolIds[i], alicePoolSetId));
        }

        assertFalse(poolHelper.isPoolInSet(bytes32(uint256(42)), alicePoolSetId), "Has invalid pool");
        assertFalse(poolHelper.isPoolInSet(bytes32(0), alicePoolSetId), "Has zero address pool");
    }

    function testDoubleAddOnePool() public {
        assertEq(poolHelper.getPoolCountForSet(alicePoolSetId), 0, "Initial pool count non-zero");

        bytes32[] memory poolIds = _addPools(2);
        poolIds[1] = poolIds[0];

        vm.expectRevert("BAL#448"); // PoolAlreadyInSet
        vm.prank(admin);
        poolHelper.addPoolsToSet(alicePoolSetId, poolIds);
    }

    function testAddPoolWithoutPermission() public {
        vm.expectRevert("BAL#446"); // OwnableUnauthorizedAccount
        vm.prank(lp);
        poolHelper.addPoolsToSet(alicePoolSetId, new bytes32[](0));
    }

    function testRemovePools() public {
        assertEq(poolHelper.getPoolCountForSet(alicePoolSetId), 0, "Initial pool count non-zero");

        bytes32[] memory poolIds = _addPools(10);
        assertEq(poolHelper.getPoolCountForSet(alicePoolSetId), 10, "Pools count should be 10");

        for (uint256 i = 0; i < poolIds.length; i++) {
            vm.expectEmit();
            emit PoolRemovedFromSet(poolIds[i], alicePoolSetId);
        }

        vm.prank(admin);
        poolHelper.removePoolsFromSet(alicePoolSetId, poolIds);

        assertEq(poolHelper.getPoolCountForSet(alicePoolSetId), 0, "End pool count non-zero");

        for (uint256 i = 0; i < poolIds.length; i++) {
            assertFalse(poolHelper.isPoolInSet(poolIds[i], alicePoolSetId));
        }
    }

    function testRemoveNonexistentPool() public {
        _addPools(10);

        vm.expectRevert("BAL#449"); // PoolNotInSet
        vm.prank(admin);
        poolHelper.removePoolsFromSet(alicePoolSetId, new bytes32[](1));
    }

    function testRemovePoolWithoutPermission() public {
        bytes32[] memory poolIds = _addPools(10);

        vm.expectRevert("BAL#446"); // OwnableUnauthorizedAccount
        vm.prank(lp);
        poolHelper.removePoolsFromSet(alicePoolSetId, poolIds);
    }

    function testGetPools() public {
        bytes32[] memory poolIds = _addPools(10);
        bytes32[] memory storedPoolIds = poolHelper.getPoolsInSet(alicePoolSetId, 0, 10);

        for (uint256 i = 0; i < poolIds.length; i++) {
            assertEq(poolIds[i], storedPoolIds[i], "Stored pool should be the same as the added pool");
        }

        storedPoolIds = poolHelper.getPoolsInSet(alicePoolSetId, 3, 5);

        for (uint256 i = 3; i < 5; i++) {
            assertEq(poolIds[i], storedPoolIds[i - 3], "Stored pool should be the same as the added pool (partial)");
        }
    }

    function testGetAllPools() public {
        bytes32[] memory poolIds = _addPools(10);
        bytes32[] memory storedPoolIds = poolHelper.getAllPoolsInSet(alicePoolSetId);

        for (uint256 i = 0; i < poolIds.length; i++) {
            assertEq(poolIds[i], storedPoolIds[i], "Stored pool should be the same as the added pool");
        }
    }

    function testGetPoolsEdgeCases() public {
        bytes32[] memory poolIds = _addPools(10);

        bytes32[] memory noPools = poolHelper.getPoolsInSet(alicePoolSetId, 5, 5);
        assertEq(noPools.length, 0, "No pools should be returned");

        bytes32[] memory lastPool = poolHelper.getPoolsInSet(alicePoolSetId, 9, 10);
        assertEq(lastPool.length, 1, "Last pool length is incorrect");
        assertEq(poolIds[9], lastPool[0], "Last pool is incorrect");

        bytes32[] memory firstPool = poolHelper.getPoolsInSet(alicePoolSetId, 0, 1);
        assertEq(firstPool.length, 1, "First pool length is incorrect");
        assertEq(poolIds[0], firstPool[0], "First pool is incorrect");
    }

    function testGetPoolsInvalidCases() public {
        uint256 poolsNum = 10;

        _addPools(poolsNum);

        vm.expectRevert("BAL#100"); // OutOfBounds
        poolHelper.getPoolsInSet(alicePoolSetId, 2, 1);

        vm.expectRevert("BAL#100"); // OutOfBounds
        poolHelper.getPoolsInSet(alicePoolSetId, 2, poolsNum + 1);

        vm.expectRevert("BAL#100"); // OutOfBounds
        poolHelper.getPoolsInSet(alicePoolSetId, poolsNum, poolsNum);
    }

    function testAddUnregisteredPool() public {
        bytes32[] memory invalidPoolIds = new bytes32[](1);
        invalidPoolIds[0] = bytes32(uint256(1234));

        vm.expectRevert("BAL#500"); // INVALID_POOL_ID
        vm.prank(admin);
        poolHelper.addPoolsToSet(alicePoolSetId, invalidPoolIds);
    }

    function testInvalidInitialOwner() public {
        vm.expectRevert("BAL#447"); // OwnableInvalidOwner
        new PoolSwapFeeHelper(IVault(address(vault)), address(0));
    }

    function testCreatePoolSetInvalidManager() public {
        // Manager cannot be the zero address.
        vm.expectRevert("BAL#451"); // InvalidPoolSetManager
        vm.prank(admin);
        poolHelper.createPoolSet(address(0));

        // We already have a pool set managed by alice, so cannot create a second one.
        vm.expectRevert("BAL#452"); // PoolSetManagerNotUnique
        vm.prank(admin);
        poolHelper.createPoolSet(alice);
    }

    function testCreatePoolSetPermissioned() public {
        vm.expectRevert("BAL#446"); // OwnableUnauthorizedAccount
        vm.prank(lp);
        poolHelper.createPoolSet(lp);
    }

    function testCreatePoolSetEvents() public {
        uint256 expectedPoolSetId = poolHelper.getNextPoolSetId();

        vm.expectEmit();
        emit PoolSetCreated(expectedPoolSetId, admin);

        vm.prank(admin);
        uint256 actualPoolSetId = poolHelper.createPoolSet(admin);

        assertEq(actualPoolSetId, expectedPoolSetId, "Wrong poolSetId (plain)");

        // Create with initial pools
        uint256 numPools = 3;

        bytes32[] memory poolIds = _generatePools(numPools);

        expectedPoolSetId++;

        vm.expectEmit();
        emit PoolSetCreated(expectedPoolSetId, lp);

        for (uint256 i = 0; i < numPools; ++i) {
            vm.expectEmit();
            emit PoolAddedToSet(poolIds[i], expectedPoolSetId);
        }

        vm.prank(admin);
        actualPoolSetId = poolHelper.createPoolSet(lp, poolIds);

        assertEq(actualPoolSetId, expectedPoolSetId, "Wrong poolSetId (with poolIds)");

        uint256 poolCount = poolHelper.getPoolCountForSet(actualPoolSetId);
        assertEq(poolCount, numPools, "Wrong pool count");

        bool hasPool = poolHelper.isPoolInSet(bytes32(0), actualPoolSetId);
        assertFalse(hasPool, "Should not have zero address");

        for (uint256 i = 0; i < numPools; ++i) {
            hasPool = poolHelper.isPoolInSet(poolIds[i], actualPoolSetId);
            assertTrue(hasPool, "Set does not contain expected pool");
        }
    }

    function testDestroyPoolSetWithPools() public {
        // Since event order isn't guaranteed, need to test this with a single pool.
        bytes32[] memory poolIds = _generatePools(1);

        vm.prank(admin);
        uint256 poolSetId = poolHelper.createPoolSet(admin, poolIds);

        // Now destroy, and make sure we get the remove event for the pool.
        vm.expectEmit();
        emit PoolRemovedFromSet(poolIds[0], poolSetId);

        vm.prank(admin);
        poolHelper.destroyPoolSet(poolSetId);
    }

    function testGetPoolSetIdForCaller() public {
        vm.prank(alice);
        uint256 poolSetId = poolHelper.getPoolSetIdForCaller();
        assertEq(poolSetId, alicePoolSetId, "Wrong poolSetId for alice");

        vm.prank(bob);
        poolSetId = poolHelper.getPoolSetIdForCaller();
        assertEq(poolSetId, bobPoolSetId, "Wrong poolSetId for bob");

        poolSetId = poolHelper.getPoolSetIdForCaller();
        assertEq(poolSetId, 0, "PoolSetId should be 0");
    }

    function testGetPoolSetIdForManager() public view {
        uint256 poolSetId = poolHelper.getPoolSetIdForManager(alice);
        assertEq(poolSetId, alicePoolSetId, "Wrong poolSetId for alice");

        poolSetId = poolHelper.getPoolSetIdForManager(bob);
        assertEq(poolSetId, bobPoolSetId, "Wrong poolSetId for bob");

        poolSetId = poolHelper.getPoolSetIdForManager(lp);
        assertEq(poolSetId, 0, "PoolSetId should be 0");
    }

    function testGetManagerForPoolSetId() public view {
        address manager = poolHelper.getManagerForPoolSet(alicePoolSetId);
        assertEq(manager, alice, "Wrong manager for alicePoolSetId");

        manager = poolHelper.getManagerForPoolSet(bobPoolSetId);
        assertEq(manager, bob, "Wrong manager for bobPoolSetId");

        manager = poolHelper.getManagerForPoolSet(45);
        assertEq(manager, address(0), "Manager should be 0");
    }

    function testPoolCountForSetErrors() public {
        uint256 poolCount = poolHelper.getPoolCountForSet(alicePoolSetId);
        assertEq(poolCount, 0, "Alice's pool set should have no pools");

        vm.expectRevert("BAL#453"); // InvalidPoolSetId
        poolHelper.getPoolCountForSet(0);

        vm.expectRevert("BAL#453"); // InvalidPoolSetId
        poolHelper.getPoolCountForSet(100);
    }

    function testSetHasPoolErrors() public {
        bool hasPool = poolHelper.isPoolInSet(ANY_POOL_ID, alicePoolSetId);
        assertFalse(hasPool, "Alice's pool set should not have a random pool");

        vm.expectRevert("BAL#453"); // InvalidPoolSetId
        poolHelper.isPoolInSet(ANY_POOL_ID, 0);

        vm.expectRevert("BAL#453"); // InvalidPoolSetId
        poolHelper.isPoolInSet(ANY_POOL_ID, 100);
    }

    function testDestroyPoolSetPermissions() public {
        vm.expectRevert("BAL#446"); // OwnableUnauthorizedAccount
        vm.prank(lp);
        poolHelper.destroyPoolSet(alicePoolSetId);
    }

    function testDestroyPoolSetErrors() public {
        vm.expectRevert("BAL#453"); // InvalidPoolSetId
        vm.prank(admin);
        poolHelper.destroyPoolSet(0);

        vm.expectRevert("BAL#453"); // InvalidPoolSetId
        vm.prank(admin);
        poolHelper.destroyPoolSet(100);
    }

    function testDestroyPoolSetEvents() public {
        vm.expectEmit();
        emit PoolSetDestroyed(alicePoolSetId, alice);

        vm.prank(alice);
        uint256 poolSetId = poolHelper.getPoolSetIdForCaller();
        assertEq(poolSetId, alicePoolSetId, "Wrong poolSetId for alice");

        // `poolSetId` will get overwritten later.
        uint256 originalPoolSetId = poolSetId;

        vm.prank(admin);
        poolHelper.destroyPoolSet(alicePoolSetId);

        // She should be removed as a manager.
        vm.prank(alice);
        poolSetId = poolHelper.getPoolSetIdForCaller();
        assertEq(poolSetId, 0, "alice still a manager");

        address manager = poolHelper.getManagerForPoolSet(originalPoolSetId);
        assertEq(manager, address(0), "Destroyed poolSetId still has a manager");

        // Set should be gone.
        vm.expectRevert("BAL#453"); // InvalidPoolSetId
        poolHelper.getPoolCountForSet(alicePoolSetId);
    }

    function testTransferPoolOwnershipErrors() public {
        // Only existing managers can transfer.
        vm.expectRevert("BAL#450"); // SenderIsNotPoolSetManager
        poolHelper.transferPoolSetOwnership(lp);

        // Cannot transfer to zero address.
        vm.expectRevert("BAL#451"); // InvalidPoolSetManager
        vm.prank(alice);
        poolHelper.transferPoolSetOwnership(address(0));

        // Cannot transfer to existing manager.
        vm.expectRevert("BAL#452"); // PoolSetManagerNotUnique
        vm.prank(alice);
        poolHelper.transferPoolSetOwnership(bob);
    }

    function testTransferPoolOwnership() public {
        vm.expectEmit();
        emit PoolSetOwnershipTransferred(alicePoolSetId, alice, lp);

        vm.prank(alice);
        poolHelper.transferPoolSetOwnership(lp);

        // Verify that it worked.
        vm.prank(alice);
        uint256 aliceId = poolHelper.getPoolSetIdForCaller();
        assertEq(aliceId, 0, "Alice still has a pool set");

        vm.prank(lp);
        uint256 poolSetId = poolHelper.getPoolSetIdForCaller();
        assertEq(poolSetId, alicePoolSetId, "Pool set not transferred");

        address manager = poolHelper.getManagerForPoolSet(poolSetId);
        assertEq(manager, lp, "Manager address not transferred");
    }

    function testIsValidPoolSetId() public view {
        assertTrue(poolHelper.isValidPoolSetId(alicePoolSetId), "Alice's pool set id not valid");
        assertTrue(poolHelper.isValidPoolSetId(bobPoolSetId), "Bob's pool set id not valid");

        assertFalse(poolHelper.isValidPoolSetId(45), "PoolSetId should not be valid");
    }

    function testAddPoolWithPoolOwner() public {
        bytes32[] memory poolIds = new bytes32[](1);

        MockWeightedPool newPool = new MockWeightedPool(
            WeightedPool.NewPoolParams({
                name: "Weighted Pool",
                symbol: "TEST",
                tokens: tokens,
                normalizedWeights: weights,
                rateProviders: new IRateProvider[](tokens.length),
                assetManagers: new address[](tokens.length),
                swapFeePercentage: DEFAULT_SWAP_FEE_PERCENTAGE
            }),
            IVault(address(vault)),
            IProtocolFeePercentagesProvider(address(protocolFeeProvider)),
            90 days,
            30 days,
            admin // Pool has a non-delegate owner
        );

        poolIds[0] = newPool.getPoolId();

        vm.expectRevert("BAL#454"); // PoolHasOwner
        vm.prank(admin);
        poolHelper.addPoolsToSet(alicePoolSetId, poolIds);
    }

    function testSetSwapFee() public {
        bytes32[] memory poolIds = _addPools(10);

        for (uint256 i = 0; i < poolIds.length; ++i) {
            vm.prank(alice);
            poolHelper.setSwapFeePercentage(poolIds[i], NEW_SWAP_FEE_PERCENTAGE);
        }

        for (uint256 i = 0; i < poolIds.length; i++) {
            (address pool, ) = vault.getPool(poolIds[i]);
            uint256 swapFeePercentage = IBasePool(pool).getSwapFeePercentage();

            assertEq(swapFeePercentage, NEW_SWAP_FEE_PERCENTAGE, "Wrong swap fee percentage");
        }
    }

    function testSetSwapFeeIfPoolIsNotInList() public {
        _addPools(10);

        vm.expectRevert("BAL#449"); // PoolNotInSet
        vm.prank(alice);
        poolHelper.setSwapFeePercentage(bytes32(0), NEW_SWAP_FEE_PERCENTAGE);
    }

    function testSetSwapFeeWithoutPermission() public {
        bytes32[] memory poolIds = _addPools(1);

        vm.expectRevert("BAL#450"); // SenderIsNotPoolSetManager
        poolHelper.setSwapFeePercentage(poolIds[0], NEW_SWAP_FEE_PERCENTAGE);
    }

    function _generatePools(uint256 length) internal returns (bytes32[] memory poolIds) {
        poolIds = new bytes32[](length);
        for (uint256 i = 0; i < length; i++) {
            MockWeightedPool newPool = new MockWeightedPool(
                WeightedPool.NewPoolParams({
                    name: "Weighted Pool",
                    symbol: "TEST",
                    tokens: tokens,
                    normalizedWeights: weights,
                    rateProviders: new IRateProvider[](tokens.length),
                    assetManagers: new address[](tokens.length),
                    swapFeePercentage: DEFAULT_SWAP_FEE_PERCENTAGE
                }),
                IVault(address(vault)),
                IProtocolFeePercentagesProvider(address(protocolFeeProvider)),
                90 days,
                30 days,
                DELEGATE_OWNER
            );

            poolIds[i] = newPool.getPoolId();
        }
    }

    function _addPools(uint256 length) internal returns (bytes32[] memory poolIds) {
        poolIds = _generatePools(length);

        vm.prank(admin);
        poolHelper.addPoolsToSet(alicePoolSetId, poolIds);
    }
}
