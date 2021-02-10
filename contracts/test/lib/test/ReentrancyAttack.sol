// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

contract ReentrancyAttack {
    function callSender(bytes4 data) public {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = msg.sender.call(abi.encodeWithSelector(data));
        require(success, "REENTRANCY_ATTACK");
    }
}
