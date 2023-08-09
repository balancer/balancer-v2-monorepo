// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../../contracts/gauges/avalanche/AvalancheRootGauge.sol";
import "../../contracts/gauges/avalanche/AvalancheRootGaugeLib.sol";
import "../../contracts/test/MockLzBALProxy.sol";
import "../../contracts/test/TestBalancerToken.sol";


contract AvalancheRootGaugeLibTest is Test {
    uint256 private minimumBridgeAmount;

    function setUp() external {
        TestBalancerToken bal = new TestBalancerToken(address(0), "", "");
        ILayerZeroBALProxy proxyMock = ILayerZeroBALProxy(address(new MockLzBALProxy()));
        uint256 decimalDifference = bal.decimals() - proxyMock.sharedDecimals();
        minimumBridgeAmount = 10**decimalDifference;
    }

    function testGetMinimumAmount(uint256 amount) external {
        uint256 minimumAmount = AvalancheRootGaugeLib.removeDust(amount, minimumBridgeAmount);
        assertApproxEqAbs(amount, minimumAmount, minimumBridgeAmount);
    }

    function testBytes32Recipient() external {
        address recipient = 0xBA1bA1Ba1bA1Ba1ba1bA1bA1bA1bA1fFffFFfFfF;
        bytes32 bytes32Recipient = AvalancheRootGaugeLib.bytes32Recipient(recipient);
        assertEq(bytes32Recipient, bytes32(0x000000000000000000000000BA1bA1Ba1bA1Ba1ba1bA1bA1bA1bA1fFffFFfFfF));
    }
}
