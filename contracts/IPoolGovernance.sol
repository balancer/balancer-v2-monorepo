pragma solidity 0.5.12;

interface IPoolGovernance {
  function setSwapFee(bytes32 poolID, uint swapFee) external;

  function setController(bytes32 poolID, address controller) external;

  function setPublicSwap(bytes32 poolID) external;

  function addInitialLiquidity(bytes32 poolID, address[] calldata initialTokens, uint[] calldata amountsIn) external;
  function addLiquidity(bytes32 poolID, uint[] calldata amountsIn) external;
  function removeLiquidity(bytes32 poolID, address recipient, uint[] calldata amountsOut) external;

  function getTokenAmountsIn(bytes32 poolID, uint ratio, uint[] calldata maxAmountsIn) external returns (uint[] memory);
  function getTokenAmountsOut(bytes32 poolID, uint ratio, uint[] calldata minAmountsOut) external returns (uint[] memory);
  function getPoolTokenBalance(bytes32 poolID, address token) external view returns (uint);
  function getPoolTokens(bytes32 poolID) external view returns (address[] memory);
}
