// Initial implementation implements a simple, pass-through sole proprietorship model
// for pool governance
pragma solidity 0.5.12;

import "./IPoolGovernance.sol";
import "./BToken.sol";

contract BasePoolTokenizer is BToken {
    IPoolGovernance public vault;
    bytes32 public poolID;

    modifier _lock_() {
        require(!_mutex, "ERR_REENTRY");
        _mutex = true;
        _;
        _mutex = false;
    }

    bool private _mutex;

    // Joining a pool
    // poolAmountOut - how much bpt the user expects to get
    // maxAmountsIn - the max amounts of each token the user is willing to add to the vault
    function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn)
        external
        _lock_
    {
        uint256 poolTotal = totalSupply();
        uint256 ratio = bdiv(poolAmountOut, poolTotal);
        require(ratio != 0, "ERR_MATH_APPROX");

        address[] memory tokens = vault.getPoolTokens(poolID);
        uint256[] memory amountsIn = vault.getTokenAmountsIn(
            poolID,
            ratio,
            maxAmountsIn
        );

        for (uint256 i = 0; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 amountIn = amountsIn[i];
            bool xfer = IERC20(t).transferFrom(
                msg.sender,
                address(vault),
                amountIn
            );
            require(xfer, "transfer must succeed");
        }

        vault.addLiquidity(poolID, amountsIn);

        _mintPoolShare(poolAmountOut);
        _pushPoolShare(msg.sender, poolAmountOut);
    }

    function exitPool(uint256 poolAmountIn, uint256[] calldata minAmountsOut)
        external
        _lock_
    {
        uint256 poolTotal = totalSupply();
        uint256 ratio = bdiv(poolAmountIn, poolTotal);
        require(ratio != 0, "ERR_MATH_APPROX");

        _pullPoolShare(msg.sender, poolAmountIn);
        _burnPoolShare(poolAmountIn);

        uint256[] memory amountsOut = vault.getTokenAmountsOut(
            poolID,
            ratio,
            minAmountsOut
        );

        vault.removeLiquidity(poolID, msg.sender, amountsOut);
    }

    // Add initial liquidity

    function _addInitialLiquidity(
        uint256 initialBPT,
        address[] memory initialTokens,
        uint256[] memory initialBalances
    ) internal {
        for (uint256 i = 0; i < initialTokens.length; i++) {
            address t = initialTokens[i];
            uint256 amountIn = initialBalances[i];
            IERC20(t).transferFrom(msg.sender, address(vault), amountIn);
        }

        vault.addInitialLiquidity(poolID, initialTokens, initialBalances);
        _mintPoolShare(initialBPT);
        _pushPoolShare(msg.sender, initialBPT);
    }

    // 'Underlying' token-manipulation functions make external calls but are NOT locked
    // You must `_lock_` or otherwise ensure reentry-safety

    function _pullPoolShare(address from, uint256 amount) internal {
        _pull(from, amount);
    }

    function _pushPoolShare(address to, uint256 amount) internal {
        _push(to, amount);
    }

    function _mintPoolShare(uint256 amount) internal {
        _mint(amount);
    }

    function _burnPoolShare(uint256 amount) internal {
        _burn(amount);
    }
}
