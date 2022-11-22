// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "../../contracts/Version.sol";

contract VersionTest is Test {
    function testVersion(string memory versionString) external {
        Version version = new Version(versionString);
        assertEq(version.version(), versionString);
    }
}
