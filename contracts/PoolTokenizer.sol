// Initial implementation implements a simple, pass-through sole proprietorship model
// for pool governance
pragma solidity 0.5.12;

import "./IPoolGovernance.sol";

contract PoolTokenizer{
  IPoolGovernance vault;
  bytes32 public poolID;

  constructor(address _vault, bytes32 _poolID) public {
    vault = IPoolGovernance(_vault);
    poolID = _poolID;
  }

  function setSwapFee(uint swapFee) public {
    vault.setSwapFee(poolID, swapFee);
  }

  function setController(address manager) public {
    vault.setController(poolID, manager);
  }

  function setPublicSwap() public {
    vault.setPublicSwap(poolID);
  }

  //function bind(address token, uint balance, uint denorm);
  //function rebind(address token, uint balance, uint denorm)
  //function unbind(address token)
}
