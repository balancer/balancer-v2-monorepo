pragma solidity 0.5.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IPoolGovernance.sol";
import "./BMath.sol";

contract MockVault is IPoolGovernance, BMath{
  uint DEFAULT_SWAP_FEE = 100;
  uint poolCount = 0;

  struct Pool {
    address controller;
    uint swapFee;
    bool swapPublic;
    address[] tokens;
  }

  struct Record {
    uint balance;
  }

  mapping (bytes32 => mapping (address => uint)) balances;
  mapping (address => uint) allocatedBalances;
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
    address[] memory tokens;
    pools[poolID] = Pool(
      msg.sender,
      DEFAULT_SWAP_FEE,
      false,
      tokens
    );
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


  function addInitialLiquidity(bytes32 poolID, address[] calldata initialTokens, uint[] calldata initialBalances) external {
    Pool memory pool = pools[poolID];
    require(pool.controller == msg.sender);
    pools[poolID].tokens = initialTokens;

    for (uint i = 0; i < initialTokens.length; i++) {
      address t = initialTokens[i];
      uint tokenAmountIn = initialBalances[i];
      require(tokenAmountIn != 0, "ERR_MATH_APPROX");
      require(IERC20(t).balanceOf(address(this)) - allocatedBalances[t] >= tokenAmountIn, "INSUFFICIENT UNALLOCATED BALANCE");

      balances[poolID][t] = tokenAmountIn;
      allocatedBalances[t] = badd(allocatedBalances[t], tokenAmountIn);
    }
  }


  function addLiquidity(bytes32 poolID, uint[] calldata amountsIn)
  external
  {
    Pool memory pool = pools[poolID];
    require(pool.controller == msg.sender);

    for (uint i = 0; i < pool.tokens.length; i++) {
      address t = pool.tokens[i];
      uint bal = balances[poolID][t];
      uint tokenAmountIn = amountsIn[i];
      require(tokenAmountIn != 0, "ERR_MATH_APPROX");
      require(bsub(IERC20(t).balanceOf(address(this)), allocatedBalances[t]) >= tokenAmountIn, "INSUFFICIENT UNALLOCATED BALANCE");

      balances[poolID][t] = badd(bal, tokenAmountIn);
      allocatedBalances[t] = badd(allocatedBalances[t], tokenAmountIn);
    }
  }

  function removeLiquidity(bytes32 poolID, address recipient, uint[] calldata amountsOut)
  external
  {
    Pool memory pool = pools[poolID];
    require(pool.controller == msg.sender);

    for (uint i = 0; i < pool.tokens.length; i++) {
      address t = pool.tokens[i];
      uint bal = balances[poolID][t];
      uint tokenAmountOut = amountsOut[i];
      require(tokenAmountOut != 0, "ERR_MATH_APPROX");
      require(allocatedBalances[t] >= tokenAmountOut, "INSUFFICIENT BALANCE TO WITHDRAW");

      bool xfer = IERC20(t).transfer(recipient, tokenAmountOut);
      require(xfer, "ERR_ERC20_FALSE");

      balances[poolID][t] = bsub(bal, tokenAmountOut);
      allocatedBalances[t] = bsub(allocatedBalances[t], tokenAmountOut);
    }
  }

  function getTokenAmountsIn(bytes32 poolID, uint ratio, uint[] calldata maxAmountsIn) external returns (uint[] memory) {
    Pool memory pool = pools[poolID];
    require(pool.tokens.length == maxAmountsIn.length, "MAX AMOUNTS IN DOES NOT MATCH TOKENS LENGTH");
    uint[] memory tokenAmountsIn = new uint[](pool.tokens.length);
    for (uint i = 0; i < pool.tokens.length; i++) {
      address t = pool.tokens[i];
      uint bal = balances[poolID][t];
      uint tokenAmountIn = bmul(ratio, bal);
      require(tokenAmountIn <= maxAmountsIn[i], "ERR_LIMIT_IN");
      tokenAmountsIn[i] = tokenAmountIn;
    }
    return tokenAmountsIn;
  }

  function getTokenAmountsOut(bytes32 poolID, uint ratio, uint[] calldata minAmountsOut) external returns (uint[] memory) {
    Pool memory pool = pools[poolID];
    require(pool.tokens.length == minAmountsOut.length, "MAX AMOUNTS IN DOES NOT MATCH TOKENS LENGTH");
    uint[] memory tokenAmountsOut = new uint[](pool.tokens.length);

    for (uint i = 0; i < pool.tokens.length; i++) {
      address t = pool.tokens[i];
      uint bal = balances[poolID][t];

      uint tokenAmountOut = bmul(ratio, bal);
      require(tokenAmountOut != 0, "ERR_MATH_APPROX");
      require(tokenAmountOut <= minAmountsOut[i], "ERR_LIMIT_OUT");

      tokenAmountsOut[i] = tokenAmountOut;
    }
    return tokenAmountsOut;
  }


  function _pullUnderlying(address erc20, address from, uint amount)
  internal
  {
    bool xfer = IERC20(erc20).transferFrom(from, address(this), amount);
    require(xfer, "ERR_ERC20_FALSE");
  }

  function getPoolTokenBalance(bytes32 poolID, address token) external view returns (uint) {
    return balances[poolID][token];
  }

  function getPoolTokens(bytes32 poolID) external view returns (address[] memory) {
    return pools[poolID].tokens;
  }

}
