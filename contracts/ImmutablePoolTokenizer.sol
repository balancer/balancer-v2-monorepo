// Initial implementation implements a simple, pass-through sole proprietorship model
// for pool governance
pragma solidity 0.5.12;

import "./IPoolGovernance.sol";
import "./BasePoolTokenizer.sol";

contract ImmutablePoolTokenizer is BasePoolTokenizer{
  address creator;

  constructor(
    address _vault, bytes32 _poolID
    // swap fee etc
  ) public {
    vault = IPoolGovernance(_vault);
    poolID = _poolID;
    creator = msg.sender;
  }

  function initPool(
    uint initialBPT, address[] calldata initialTokens, uint[] calldata initialBalances
  ) external {
    require(msg.sender == creator, "creator must initialize pool");
    _addInitialLiquidity(initialBPT, initialTokens, initialBalances);
  }
}
