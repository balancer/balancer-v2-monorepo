// Initial implementation implements a simple, pass-through sole proprietorship model
// for pool governance
pragma solidity 0.5.12;

import "./IPoolGovernance.sol";
import "./BToken.sol";

contract PoolTokenizer is BToken{
  IPoolGovernance vault;
  bytes32 public poolID;
  address owner;

  constructor(address _vault, bytes32 _poolID) public {
    vault = IPoolGovernance(_vault);
    poolID = _poolID;
    owner = msg.sender;
  }

  modifier _lock_() {
    require(!_mutex, "ERR_REENTRY");
    _mutex = true;
    _;
    _mutex = false;
  }

  modifier onlyOwner() {
    require(msg.sender == owner, "Must be the contract owner");
    _;
  }

  bool private _mutex;
  

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


  // Add the initial liquidity to a pool
  function initPool(uint initialBPT, address[] calldata initialTokens, uint[] calldata initialBalances) external onlyOwner {
    require(totalSupply() == 0, "POOL ALREADY INITIALIZED");
    require(msg.sender == owner, "MUST BE OWNER");

    for (uint i = 0; i < initialTokens.length; i++) {
      address t = initialTokens[i];
      uint amountIn = initialBalances[i];
      IERC20(t).transferFrom(msg.sender, address(vault), amountIn);
    }

    vault.addInitialLiquidity(poolID, initialTokens, initialBalances);
    _mintPoolShare(initialBPT);
    _pushPoolShare(msg.sender, initialBPT);
  }


  // Joining a pool
  // poolAmountOut - how much bpt the user expects to get
  // maxAmountsIn - the max amounts of each token the user is willing to add to the vault
  function joinPool(uint poolAmountOut, uint[] calldata maxAmountsIn)
  external
  _lock_
  {
    uint poolTotal = totalSupply();
    uint ratio = bdiv(poolAmountOut, poolTotal);
    require(ratio != 0, "ERR_MATH_APPROX");


    address[] memory tokens = vault.getPoolTokens(poolID);
    uint[] memory amountsIn = vault.getTokenAmountsIn(poolID, ratio, maxAmountsIn);

    for (uint i = 0; i < tokens.length; i++) {
      address t = tokens[i];
      uint amountIn = amountsIn[i];
      bool xfer = IERC20(t).transferFrom(msg.sender, address(vault), amountIn);
      require(xfer, "transfer must succeed");
    }

    vault.addLiquidity(poolID, amountsIn);

    _mintPoolShare(poolAmountOut);
    _pushPoolShare(msg.sender, poolAmountOut);
  }

  function exitPool(uint poolAmountIn, uint[] calldata minAmountsOut)
  external
  _lock_
  {
    uint poolTotal = totalSupply();
    uint ratio = bdiv(poolAmountIn, poolTotal);
    require(ratio != 0, "ERR_MATH_APPROX");

    _pullPoolShare(msg.sender, poolAmountIn);
    _burnPoolShare(poolAmountIn);

    uint[] memory amountsOut = vault.getTokenAmountsOut(poolID, ratio, minAmountsOut);

    vault.removeLiquidity(poolID, msg.sender, amountsOut);
  }

  // 'Underlying' token-manipulation functions make external calls but are NOT locked
  // You must `_lock_` or otherwise ensure reentry-safety

  function _pullPoolShare(address from, uint amount)
  internal
  {
    _pull(from, amount);
  }

  function _pushPoolShare(address to, uint amount)
  internal
  {
    _push(to, amount);
  }

  function _mintPoolShare(uint amount)
  internal
  {
    _mint(amount);
  }

  function _burnPoolShare(uint amount)
  internal
  {
    _burn(amount);
  }
}
