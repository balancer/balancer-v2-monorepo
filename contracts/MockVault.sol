pragma solidity 0.5.12;

import "./IPoolGovernance.sol";

contract MockVault is IPoolGovernance{
  uint DEFAULT_SWAP_FEE = 100;
  uint poolCount = 0;

  struct Pool {
    address controller;
    uint swapFee;
    bool swapPublic;
  }

  mapping (bytes32 => Pool) public pools;
  mapping (bytes32 => bool) public poolExists;

  modifier ensurePoolExists(bytes32 poolID) {
    require(poolExists[poolID]);
    _;
  }

  function createPool(bytes32 poolID) public {
    require(!poolExists[poolID]);
    poolCount++;
    poolExists[poolID] = true;
    pools[poolID] = Pool(msg.sender, DEFAULT_SWAP_FEE, false);
  }

  function setSwapFee(bytes32 poolID, uint swapFee) public
  ensurePoolExists(poolID)
  {
    Pool memory pool = pools[poolID];
    require(pool.controller == msg.sender);

    pools[poolID].swapFee = swapFee;
  }

  function setController(bytes32 poolID, address controller) public
  ensurePoolExists(poolID)
  {
    Pool memory pool = pools[poolID];
    require(pool.controller == msg.sender);

    pools[poolID].controller = controller;
  }

  function setPublicSwap(bytes32 poolID) public
  ensurePoolExists(poolID)
  {
    Pool memory pool = pools[poolID];
    require(pool.controller == msg.sender);

    pools[poolID].swapPublic = true;
  }
}
