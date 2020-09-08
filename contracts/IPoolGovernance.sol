pragma solidity 0.5.12;

interface IPoolGovernance {
  function setSwapFee(bytes32 poolID, uint swapFee) external;

  function setController(bytes32 poolID, address controller) external;

  function setPublicSwap(bytes32 poolID) external;

  //function bind(bytes32 poolID, address token, uint balance, uint denorm);
  //function rebind(bytes32 poolID, address token, uint balance, uint denorm);
  //function unbind(bytes32 poolID, address token);
}
