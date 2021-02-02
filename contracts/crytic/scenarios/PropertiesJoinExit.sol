import "../../math/FixedPoint.sol";
import "../../math/LogExpMath.sol";

contract PropertiesJoinExit{
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    function _tokenInForExactBPTOut(
        uint256 tokenBalance,
        uint256 tokenNormalizedWeight,
        uint256 bptAmountOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // Calculate the factor by which the invariant will increase after minting BPTAmountOut
        uint256 invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);

        // Calculate by how much the token balance has to increase to cause invariantRatio
        uint256 tokenBalanceRatio = LogExpMath.pow(invariantRatio, FixedPoint.ONE.div(tokenNormalizedWeight));
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(tokenNormalizedWeight);
        uint256 amountInAfterFee = tokenBalance.mul(tokenBalanceRatio.sub(FixedPoint.ONE));

        return amountInAfterFee.div(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee)));
    }
    
    function exploit_joinPoolTokenInForExactBPTOut(
        uint256 tokenBalance,
        uint256 bptAmountOut,
        uint256 bptTotalSupply
    ) public {
        uint one = 1;
        uint256 tokenNormalizedWeight = one.div(2);
        require(bptAmountOut>1 ether);
        require(tokenBalance>0);
        require(bptTotalSupply>0);
        assert(_tokenInForExactBPTOut(tokenBalance, tokenNormalizedWeight, bptAmountOut, bptTotalSupply, 0)==0);
    }
    function _bptInForExactTokensOut(
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // First loop to calculate the weighted balance ratio
        uint256[] memory tokenBalanceRatiosWithoutFee = new uint256[](amountsOut.length);
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            tokenBalanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).div(balances[i]); //128
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(normalizedWeights[i]));
        }

        //Second loop to calculate new amounts in taking into account the fee on the % excess
        uint256 invariantRatio = FixedPoint.ONE;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 tokenBalancePercentageExcess;
            uint256 tokenBalanceRatio;
            // For each ratioSansFee, compare with the total weighted ratio (weightedBalanceRatio) and
            // decrease the fee from what goes above it
            if (weightedBalanceRatio <= tokenBalanceRatiosWithoutFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = weightedBalanceRatio.sub(tokenBalanceRatiosWithoutFee[i]).div(
                    FixedPoint.ONE.sub(tokenBalanceRatiosWithoutFee[i])
                );
            }

            uint256 amountOutBeforeFee = amountsOut[i].div(
                FixedPoint.ONE.sub(swapFee.mul(tokenBalancePercentageExcess))
            );

            tokenBalanceRatio = FixedPoint.ONE.sub((amountOutBeforeFee).div(balances[i]));

            invariantRatio = invariantRatio.mul(LogExpMath.pow(tokenBalanceRatio, normalizedWeights[i]));
        }

        return bptTotalSupply.mul(FixedPoint.ONE.sub(invariantRatio));
    }

    function exploit_exitPoolBPTInForExactTokensOut(
        uint256 balance_0,
        uint256 balance_1,
        uint256 amountOut_0,
        uint256 amountOut_1,
        uint256 bptTotalSupply
    ) public {
        uint256[] memory normalizedWeights = new uint256[](2);
        uint256[] memory balances = new uint256[](2);
        uint256[] memory amountsOut = new uint256[](2);

        uint one = 1;
        uint256 weight = one.div(2);
        normalizedWeights[0] = weight;
        normalizedWeights[1] = weight;

        require(balance_0> 1 ether);
        require(balance_1> 1 ether);
        balances[0] = balance_0;
        balances[1] = balance_1;

        require(amountOut_0> 100);
        require(amountOut_1> 100);
        amountsOut[0] = amountOut_0;
        amountsOut[1] = amountOut_1;


        require(bptTotalSupply>0);
        assert(_bptInForExactTokensOut(balances, normalizedWeights, amountsOut, bptTotalSupply, 0)==0);
    }
    function _getSupplyRatio(uint256 amount, uint256 poolTotal) pure internal returns (uint256) {
        uint256 ratio = amount.div(poolTotal);
        require(ratio != 0, "ERR_MATH_APPROX");
        return ratio;
    }
    function exploit_joinExit(uint256 poolAmountOut, uint poolAmountIn, uint256 pool_initial_supply, uint token_balance) external {

        // model joinPool
        require(token_balance>1 ether/100);
        require(pool_initial_supply>1 ether/100);

        uint256 ratio = _getSupplyRatio(poolAmountOut, pool_initial_supply);

        uint token_amount_in = ratio.mul(token_balance);

        uint pool_suppy = pool_initial_supply.add(poolAmountOut);
        token_balance = token_balance.add(token_amount_in);

        // model exitPool without fee
        require(poolAmountIn<poolAmountOut);
        ratio = _getSupplyRatio(poolAmountIn, pool_suppy);

        uint token_amount_out = token_balance.mul(ratio);
        assert(token_amount_out>= token_amount_in);
    }

}