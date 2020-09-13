// Initial implementation implements a simple, pass-through sole proprietorship model
// for pool governance
pragma solidity 0.5.12;

import "./BasePoolTokenizer.sol";

contract OwnablePoolTokenizer is BasePoolTokenizer {
  address owner;

  constructor(address _vault, bytes32 _poolID) public {
    vault = IPoolGovernance(_vault);
    poolID = _poolID;
    owner = msg.sender;
  }

  modifier onlyOwner() {
    require(msg.sender == owner, "Must be the contract owner");
    _;
  }

  // Add the initial liquidity to a pool
  function initPool(uint initialBPT, address[] calldata initialTokens, uint[] calldata initialBalances) external onlyOwner {
    require(totalSupply() == 0, "POOL ALREADY INITIALIZED");
    require(msg.sender == owner, "MUST BE OWNER");

    _addInitialLiquidity(initialBPT, initialTokens, initialBalances);
  }


  // Governance functions
  function setOwner(address newOwner) public onlyOwner {
    owner = newOwner;
  }

  function setSwapFee(uint swapFee) public onlyOwner {
    vault.setSwapFee(poolID, swapFee);
  }

  function setController(address manager) public onlyOwner {
    vault.setController(poolID, manager);
  }

  function setPublicSwap() public onlyOwner {
    vault.setPublicSwap(poolID);
  }
}
