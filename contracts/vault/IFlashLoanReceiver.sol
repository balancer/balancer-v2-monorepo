pragma solidity ^0.7.1;

/**
 * @title IFlashLoanReceiver interface
 * @notice Interface for a recipient of a flash loan
 * @author Aave
 * @dev implement this interface to develop a flashloan-compatible flashLoanReceiver contract
 **/
interface IFlashLoanReceiver {
    function executeOperation(
        address _reserve,
        uint256 _amount,
        uint256 _fee,
        bytes calldata _params
    ) external;
}
