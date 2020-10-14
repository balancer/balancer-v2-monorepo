pragma solidity ^0.7.1;

/**
 * Interface that Callees for Vault must implement in order to swap tokens.
 */
interface ICallee {
    function callback(address recipient, bytes calldata callbackData) external;
}
