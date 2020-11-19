// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.1;

/* solhint-disable private-vars-leading-underscore */

library FixedPoint {
    uint128 internal constant ONE = 10**18; // 18 decimal places

    uint256 internal constant MIN_POW_BASE = 1 wei;
    uint256 internal constant MAX_POW_BASE = (2 * ONE) - 1 wei;
    uint256 internal constant POW_PRECISION = ONE / 10**10;

    function btoi(uint256 a) internal pure returns (uint256) {
        return a / ONE;
    }

    function floor(uint256 a) internal pure returns (uint256) {
        return btoi(a) * ONE;
    }

    function abs(int256 a) internal pure returns (uint256) {
        if (a > 0) {
            return uint256(a);
        } else {
            // TODO: check valid
            return uint256(-a);
        }
    }

    function abs128(int128 a) internal pure returns (uint128) {
        if (a > 0) {
            return uint128(a);
        } else {
            // TODO: check valid
            return uint128(-a);
        }
    }

    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "ERR_ADD_OVERFLOW");
        return c;
    }

    function add128(uint128 a, uint128 b) internal pure returns (uint128) {
        uint128 c = a + b;
        require(c >= a, "ERR_ADD_OVERFLOW");
        return c;
    }

    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        (uint256 c, bool flag) = subSign(a, b);
        require(!flag, "ERR_SUB_UNDERFLOW");
        return c;
    }

    function subSign(uint256 a, uint256 b) internal pure returns (uint256, bool) {
        if (a >= b) {
            return (a - b, false);
        } else {
            return (b - a, true);
        }
    }

    function sub128(uint128 a, uint128 b) internal pure returns (uint128) {
        (uint128 c, bool flag) = subSign128(a, b);
        require(!flag, "ERR_SUB_UNDERFLOW");
        return c;
    }

    function subSign128(uint128 a, uint128 b) internal pure returns (uint128, bool) {
        if (a >= b) {
            return (a - b, false);
        } else {
            return (b - a, true);
        }
    }

    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c0 = a * b;
        require(a == 0 || c0 / a == b, "ERR_MUL_OVERFLOW");
        uint256 c1 = c0 + (ONE / 2);
        require(c1 >= c0, "ERR_MUL_OVERFLOW");
        uint256 c2 = c1 / ONE;
        return c2;
    }

    function mul128(uint128 a, uint128 b) internal pure returns (uint128) {
        uint128 c0 = a * b;
        require(a == 0 || c0 / a == b, "ERR_MUL_OVERFLOW");
        uint128 c1 = c0 + (ONE / 2);
        require(c1 >= c0, "ERR_MUL_OVERFLOW");
        uint128 c2 = c1 / ONE;
        return c2;
    }

    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "ERR_DIV_ZERO");
        uint256 c0 = a * ONE;
        require(a == 0 || c0 / a == ONE, "ERR_DIV_INTERNAL"); // mul overflow
        uint256 c1 = c0 + (b / 2);
        require(c1 >= c0, "ERR_DIV_INTERNAL"); //  add require
        uint256 c2 = c1 / b;
        return c2;
    }

    function div128(uint128 a, uint128 b) internal pure returns (uint128) {
        require(b != 0, "ERR_DIV_ZERO");
        uint128 c0 = a * ONE;
        require(a == 0 || c0 / a == ONE, "ERR_DIV_INTERNAL"); // mul overflow
        uint128 c1 = c0 + (b / 2);
        require(c1 >= c0, "ERR_DIV_INTERNAL"); //  add require
        uint128 c2 = c1 / b;
        return c2;
    }

    // DSMath.wpow
    function powi(uint256 a, uint256 n) internal pure returns (uint256) {
        uint256 z = n % 2 != 0 ? a : ONE;

        for (n /= 2; n != 0; n /= 2) {
            a = mul(a, a);

            if (n % 2 != 0) {
                z = mul(z, a);
            }
        }
        return z;
    }

    // Compute b^(e.w) by splitting it into (b^e)*(b^0.w).
    // Use `powi` for `b^e` and `powK` for k iterations
    // of approximation of b^0.w
    function pow(uint256 base, uint256 exp) internal pure returns (uint256) {
        require(base >= MIN_POW_BASE, "ERR_POW_BASE_TOO_LOW");
        require(base <= MAX_POW_BASE, "ERR_POW_BASE_TOO_HIGH");

        uint256 whole = floor(exp);
        uint256 remain = sub(exp, whole);

        uint256 wholePow = powi(base, btoi(whole));

        if (remain == 0) {
            return wholePow;
        }

        uint256 partialResult = powApprox(base, remain, POW_PRECISION);
        return mul(wholePow, partialResult);
    }

    function powApprox(
        uint256 base,
        uint256 exp,
        uint256 precision
    ) internal pure returns (uint256) {
        // term 0:
        uint256 a = exp;
        (uint256 x, bool xneg) = subSign(base, ONE);
        uint256 term = ONE;
        uint256 sum = term;
        bool negative = false;

        // term(k) = numer / denom
        //         = (product(a - i - 1, i=1-->k) * x^k) / (k!)
        // each iteration, multiply previous term by (a-(k-1)) * x / k
        // continue until term is less than precision
        for (uint256 i = 1; term >= precision; i++) {
            uint256 bigK = i * ONE;
            (uint256 c, bool cneg) = subSign(a, sub(bigK, ONE));
            term = mul(term, mul(c, x));
            term = div(term, bigK);
            if (term == 0) break;

            if (xneg) negative = !negative;
            if (cneg) negative = !negative;
            if (negative) {
                sum = sub(sum, term);
            } else {
                sum = add(sum, term);
            }
        }

        return sum;
    }
}
