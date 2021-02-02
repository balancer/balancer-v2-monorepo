import "../../math/FixedPoint.sol";

contract PropertiesStablecoinMath{
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    /**********************************************************************************************
    // oneTokenSwapFee - polynomial equation to solve                                            //
    // af = fee amount to calculate in one token                                                 //
    // bf = balance of token                                                                     //
    // f = bf - af                                                                               //
    // D = old invariant                            D                     D^(n+1)                //
    // A = amplifier               f^2 + ( S - ----------  - 1) * f -  ------------- = 0         //
    // n = number of tokens                    (A * n^n)               A * n^2n * P              //
    // S = sum of final balances but f                                                           //
    // P = product of final balances but f                                                       //
    **********************************************************************************************/
    function _calculateOneTokenSwapFee(
        uint256 amp,
        uint256[] memory balances,
        uint256 lastInvariant,
        uint256 tokenIndex
    ) internal pure returns (uint256) {
        uint256 inv = lastInvariant;
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 ampTimesTotal = amp * totalCoins;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i != tokenIndex) {
                x = balances[i];
            } else {
                continue;
            }
            sum += x;
            p = (p * inv) / (x * totalCoins);
        }
        p = (p * inv) / (ampTimesTotal * totalCoins);
        uint256 b = sum + inv / ampTimesTotal;
        uint256 y = ((inv - b) + FixedPoint.sqrt((inv - b) * (inv - b) + 4 * p)) / 2;
        return (balances[tokenIndex] - y - 1);
    } 

    function one_token_swap_positive_root(uint256 amp, uint256[] memory balances, uint256 lastInvariant, uint256 tokenIndex) public {
        uint256 one = 1 ether;
        uint256 sum = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sum = sum + balances[i];
        }
        require(amp > (one).div(sum.powi(sum)));
        
        require(balances.length >= 2);
        require(tokenIndex>= 0 && tokenIndex< balances.length);
        assert(_calculateOneTokenSwapFee(amp, balances, lastInvariant, tokenIndex)>0);
    }
    function _getAccumulatedSwapFees(uint256 _amp, uint256[] memory balances, uint256 _lastInvariant) internal view returns (uint256[] memory) {
        uint256[] memory swapFeesCollected = new uint256[](balances.length);
        
        for (uint256 index = 0; index < balances.length; index++) {
            swapFeesCollected[index] = _calculateOneTokenSwapFee(_amp, balances, _lastInvariant, index);
        }

        return swapFeesCollected;
    }
    function test_calculate_fee_difference(uint256 amp, uint256[] memory balances, uint256 lastInvariant, uint256 tokenIndex) public {
        uint256 one = 1 ether;
        uint256 sum = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sum = sum + balances[i];
        }
        require(amp > (one).div(sum.powi(sum)));
        
        require(balances.length >= 2);
        require(tokenIndex>= 0 && tokenIndex< balances.length);
        uint256[] memory swapFeesCollected = _getAccumulatedSwapFees(amp, balances, lastInvariant);

        uint256 diff = swapFeesCollected[0].sub(swapFeesCollected[1]);
        for (uint256 i = 1; i < swapFeesCollected.length; i++) {
            uint256 currDiff = swapFeesCollected[i+1].sub(swapFeesCollected[i]);
            if (currDiff > diff) {
                diff = currDiff;
            }
        }
        assert(diff < 1 ether);
    }
   
    /**********************************************************************************************
    // inGivenOut token x for y - polynomial equation to solve                                   //
    // ax = amount in to calculate                                                               //
    // bx = balance token in                                                                     //
    // x = bx + ax                                                                               //
    // D = invariant                               D                     D^(n+1)                 //
    // A = amplifier               x^2 + ( S - ----------  - 1) * x -  ------------- = 0         //
    // n = number of tokens                    (A * n^n)               A * n^2n * P              //
    // S = sum of final balances but x                                                           //
    // P = product of final balances but x                                                       //
    **********************************************************************************************/
    function _inGivenOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut
    ) internal pure returns (uint256) {
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 ampTimesTotal = amp * totalCoins;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i == tokenIndexOut) {
                x = balances[i] - tokenAmountOut;
            } else if (i != tokenIndexIn) {
                x = balances[i];
            } else {
                continue;
            }
            sum += x;
            p = (p * inv) / (x * totalCoins);
        }
        p = (p * inv) / (ampTimesTotal * totalCoins);
        uint256 b = sum + inv / ampTimesTotal;
        uint256 y = ((inv - b) + FixedPoint.sqrt((inv - b) * (inv - b) + 4 * p)) / 2;
        return (y - balances[tokenIndexIn] + 1);
    }

    function in_given_out_positive_root(uint256 amp, uint256[] memory balances, uint256 tokenIndexIn, uint256 tokenIndexOut, uint256 tokenAmountOut) public {
        uint256 one = 1;
        uint256 sum = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sum = sum + balances[i];
            require(balances[i]> 1 ether);
        }
        require(amp > (one).div(sum.powi(sum)));
        
        require(balances.length >= 2);
        require(tokenIndexIn >= 0 && tokenIndexIn < balances.length);
        require(tokenIndexOut >= 0 && tokenIndexOut < balances.length);
        require(tokenAmountOut > 1 ether/1000);
        assert(_inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountOut) > 0);
    }
    /**********************************************************************************************
    // outGivenIn token x for y - polynomial equation to solve                                   //
    // ay = amount out to calculate                                                              //
    // by = balance token out                                                                    //
    // y = by - ay                                                                               //
    // D = invariant                               D                     D^(n+1)                 //
    // A = amplifier               y^2 + ( S - ----------  - 1) * y -  ------------- = 0         //
    // n = number of tokens                    (A * n^n)               A * n^2n * P              //
    // S = sum of final balances but y                                                           //
    // P = product of final balances but y                                                       //
    **********************************************************************************************/
    function _outGivenIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) internal pure returns (uint256) {
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 ampTimesTotal = amp * totalCoins;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i == tokenIndexIn) {
                x = balances[i] + tokenAmountIn;
            } else if (i != tokenIndexOut) {
                x = balances[i];
            } else {
                continue;
            }
            sum += x;
            p = (p * inv) / (x * totalCoins);
        }
        p = (p * inv) / (ampTimesTotal * totalCoins);
        uint256 b = sum + inv / ampTimesTotal;
        uint256 y = ((inv - b) + FixedPoint.sqrt((inv - b) * (inv - b) + 4 * p)) / 2;
        return (balances[tokenIndexOut] - y - 1);
    }
    function out_given_in_positive_root(uint256 amp, uint256[] memory balances, uint256 tokenIndexIn, uint256 tokenIndexOut, uint256 tokenAmountIn) public {
        uint256 one = 1 ether;
        uint256 sum = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sum = sum + balances[i];
        }
        require(amp > (one).div(sum.powi(sum)));
        
        require(balances.length >= 2);
        require(tokenIndexIn >= 0 && tokenIndexIn < balances.length);
        require(tokenIndexOut >= 0 && tokenIndexOut < balances.length);
        require(tokenAmountIn >= 1 ether/10);
        assert(_outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountIn) > 0);
    }

    /**********************************************************************************************
    // invariant                                                                                 //
    // D = invariant to compute                                                                  //
    // A = amplifier                n * D^2 + A * n^n * S * (n^n * P / D^(n−1))                  //
    // S = sum of balances         ____________________________________________                  //
    // P = product of balances    (n+1) * D + ( A * n^n − 1)* (n^n * P / D^(n−1))                //
    // n = number of tokens                                                                      //
    **********************************************************************************************/
    function _invariant(uint256 amp, uint256[] memory balances) internal pure returns (uint256) {
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        for (uint256 i = 0; i < totalCoins; i++) {
            sum = sum + balances[i];
        }
        if (sum == 0) {
            return 0;
        }
        uint256 prevInv = 0;
        uint256 inv = sum;
        uint256 ampTimesTotal = amp * totalCoins;

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = totalCoins * balances[0];
            for (uint256 j = 1; j < totalCoins; j++) {
                P_D = (P_D * balances[j] * totalCoins) / inv;
            }
            prevInv = inv;
            inv =
                (totalCoins * inv * inv + ampTimesTotal * sum * P_D) /
                ((totalCoins + 1) * inv + (ampTimesTotal - 1) * P_D);
            // Equality with the precision of 1

            if (inv > prevInv) {
                if ((inv - prevInv) <= 1) {
                    break;
                }
            } else if ((prevInv - inv) <= 1) {
                break;
            }
        }
        return inv;
    }
    function invariant_positive(uint256 amp, uint256[] memory balances) public {
        uint256 one = 1 ether;
        uint256 sum = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sum = sum + balances[i];
        }
        require(amp > (one).div(sum.powi(sum)));
        require(balances.length > 0);
        assert(_invariant(amp,balances) > 0);
    }
}