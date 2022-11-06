pragma solidity >=0.5.0 <0.9.0;

contract ICToken {

    /**
     * @dev returns the address of the cToken's underlying asset
     */
    function ASSET() external view returns (address);

    /**
     * @dev returns the address of the CToken's lending pool
     */
    function LENDING_POOL() external view returns ();

    /**
     * @dev Adds the wrapped tokens to compounds liquidity pool
     */
    function _mint(uint256) external returns (uint256);

    /**
     * @dev Withdraws unwrapped tokens from compounds liquidity pool
     */
    function _redeem(uint256) external returns (uint256);

    //function getTokenAmount(uint256) external view returns (uint256);
}
