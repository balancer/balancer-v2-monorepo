// SPDX-License-Identifier: GPL-3.0-or-later

import "../../lib/math/FixedPoint.sol";
import "../../lib/math/LogExpMath.sol";

pragma solidity ^0.7.1;

contract PropertiesSwap{
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the
    // current balances and weights.
    function _outGivenIn(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 tokenAmountIn
    ) public pure returns (uint256) {
        /**********************************************************************************************
        // outGivenIn                                                                                //
        // aO = tokenAmountOut                                                                       //
        // bO = tokenBalanceOut                                                                      //
        // bI = tokenBalanceIn              /      /            bI             \    (wI / wO) \      //
        // aI = tokenAmountIn    aO = bO * |  1 - | --------------------------  | ^            |     //
        // wI = tokenWeightIn               \      \       ( bI + aI )         /              /      //
        // wO = tokenWeightOut                                                                       //
        **********************************************************************************************/
        uint256 quotient = tokenBalanceIn.div(tokenBalanceIn.add(tokenAmountIn));
        uint256 weightRatio = tokenWeightIn.div(tokenWeightOut);
        uint256 ratio = FixedPoint.ONE.sub(LogExpMath.pow(quotient, weightRatio));
        return tokenBalanceOut.mul(ratio);
    }
    function _inGivenOut(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 tokenAmountOut
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // inGivenOut                                                                                //
        // aO = tokenAmountOut                                                                       //
        // bO = tokenBalanceOut                                                                      //
        // bI = tokenBalanceIn              /  /            bO             \    (wO / wI)      \     //
        // aI = tokenAmountIn    aI = bI * |  | --------------------------  | ^            - 1  |    //
        // wI = tokenWeightIn               \  \       ( bO - aO )         /                   /     //
        // wO = tokenWeightOut                                                                       //
        **********************************************************************************************/
        uint256 quotient = tokenBalanceOut.div(tokenBalanceOut.sub(tokenAmountOut));
        uint256 weightRatio = tokenWeightOut.div(tokenWeightIn);
        uint256 ratio = LogExpMath.pow(quotient, weightRatio).sub(FixedPoint.ONE);
        return tokenBalanceIn.mul(ratio);
    }
    function exploit_out_given_in(uint sent_token_b) public pure returns(uint, uint, uint){
        uint weight = FixedPoint.ONE.div(2);
        require(sent_token_b < 10 ether);
        uint balance_token_A = 10 ether;
        uint balance_token_B = 10 ether;
        // exchange token A -> token B
        uint sent_token_a = _inGivenOut(balance_token_A, weight, balance_token_B, weight, balance_token_B-1);
        balance_token_A += sent_token_a;
        balance_token_B = 1;
        // exchange token B -> token A
        uint received_token_a = _outGivenIn(balance_token_B, weight, balance_token_A, weight, sent_token_b);
        assert(sent_token_a<received_token_a);
    }

    function exploit_in_given_out(uint256 tokenBalanceIn, uint256 tokenBalanceOut, uint256 tokenAmountOut) external pure {
        uint one = 1;
        uint weight = one.div(2);

        require(tokenBalanceIn>1 ether);
        require(tokenBalanceOut>1 ether);
        require(tokenAmountOut>1 ether/1000);

        assert(_inGivenOut(tokenBalanceIn, weight, tokenBalanceOut, weight, tokenAmountOut) ==0);
    }
}