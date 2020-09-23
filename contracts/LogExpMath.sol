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

// There's plenty of linter errors caused by this file, we'll eventually
// revisit it to make it more readable, verfiable and testable.
/* solhint-disable */

library LogExpMath {
    int256 constant DECIMALS = 10**18;
    int256 constant DOUBLE_DECIMALS = DECIMALS * DECIMALS;
    int256 constant PRECISION = 10**20;
    int256 constant DOUBLE_PRECISION = PRECISION * PRECISION;
    int256 constant PRECISION_LOG_UNDER_BOUND = DECIMALS - 10**17;
    int256 constant PRECISION_LOG_UPPER_BOUND = DECIMALS + 10**17;
    int256 constant EXPONENT_LB = -41446531673892822312;
    int256 constant EXPONENT_UB = 130700829182905140221;
    int256 constant MILD_EXPONENT_BOUND = 2**254 / PRECISION;

    int256 constant x0 = 128000000000000000000; //2ˆ7
    int256 constant a0 = 38877084059945950922200000000000000000000000000000000000; //eˆ(x0)
    int256 constant x1 = 64000000000000000000; //2ˆ6
    int256 constant a1 = 6235149080811616882910000000; //eˆ(x1)
    int256 constant x2 = 3200000000000000000000; //2ˆ5
    int256 constant a2 = 7896296018268069516100000000000000; //eˆ(x2)
    int256 constant x3 = 1600000000000000000000; //2ˆ4
    int256 constant a3 = 888611052050787263676000000; //eˆ(x3)
    int256 constant x4 = 800000000000000000000; //2ˆ3
    int256 constant a4 = 298095798704172827474000; //eˆ(x4)
    int256 constant x5 = 400000000000000000000; //2ˆ2
    int256 constant a5 = 5459815003314423907810; //eˆ(x5)
    int256 constant x6 = 200000000000000000000; //2ˆ1
    int256 constant a6 = 738905609893065022723; //eˆ(x6)
    int256 constant x7 = 100000000000000000000; //2ˆ0
    int256 constant a7 = 271828182845904523536; //eˆ(x7)
    int256 constant x8 = 50000000000000000000; //2ˆ-1
    int256 constant a8 = 164872127070012814685; //eˆ(x8)
    int256 constant x9 = 25000000000000000000; //2ˆ-2
    int256 constant a9 = 128402541668774148407; //eˆ(x9)
    int256 constant x10 = 12500000000000000000; //2ˆ-3
    int256 constant a10 = 113314845306682631683; //eˆ(x10)
    int256 constant x11 = 6250000000000000000; //2ˆ-4
    int256 constant a11 = 106449445891785942956; //eˆ(x11)

    /**
     * Calculate the natural exponentiation of a number with 18 decimals precision.
     * @param x Exponent with 18 decimal places.
     * @notice Max x is log((2^255 - 1) / 10^20) = 130.700829182905140221
     * @notice Min x log(0.000000000000000001) = -41.446531673892822312
     * @return eˆx
     */
    function n_exp(int256 x) internal pure returns (int256) {
        require(
            x >= EXPONENT_LB && x <= EXPONENT_UB,
            "Natural exp argument must be between -41.446531673892822312 and 130.700829182905140221"
        );
        if (x < 0) return (DOUBLE_DECIMALS / n_exp(-x));
        int256 ans = PRECISION;
        int256 last = 1;
        if (x >= x0) {
            last = a0;
            x -= x0;
        }
        if (x >= x1) {
            last *= a1;
            x -= x1;
        }
        x *= 100;
        if (x >= x2) {
            ans = (ans * a2) / PRECISION;
            x -= x2;
        }
        if (x >= x3) {
            ans = (ans * a3) / PRECISION;
            x -= x3;
        }
        if (x >= x4) {
            ans = (ans * a4) / PRECISION;
            x -= x4;
        }
        if (x >= x5) {
            ans = (ans * a5) / PRECISION;
            x -= x5;
        }
        if (x >= x6) {
            ans = (ans * a6) / PRECISION;
            x -= x6;
        }
        if (x >= x7) {
            ans = (ans * a7) / PRECISION;
            x -= x7;
        }
        if (x >= x8) {
            ans = (ans * a8) / PRECISION;
            x -= x8;
        }
        if (x >= x9) {
            ans = (ans * a9) / PRECISION;
            x -= x9;
        }
        int256 s = PRECISION;
        int256 t = x;
        s += t;
        t = ((t * x) / 2) / PRECISION;
        s += t;
        t = ((t * x) / 3) / PRECISION;
        s += t;
        t = ((t * x) / 4) / PRECISION;
        s += t;
        t = ((t * x) / 5) / PRECISION;
        s += t;
        t = ((t * x) / 6) / PRECISION;
        s += t;
        t = ((t * x) / 7) / PRECISION;
        s += t;
        t = ((t * x) / 8) / PRECISION;
        s += t;
        t = ((t * x) / 9) / PRECISION;
        s += t;
        t = ((t * x) / 10) / PRECISION;
        s += t;
        t = ((t * x) / 11) / PRECISION;
        s += t;
        t = ((t * x) / 12) / PRECISION;
        s += t;
        return (((ans * s) / PRECISION) * last) / 100;
    }

    /**
     * Calculate the natural logarithm of a number with 18 decimals precision.
     * @param a Positive number with 18 decimal places.
     * @return ln(x)
     */
    function n_log(int256 a) internal pure returns (int256) {
        require(a > 0, "Natural log argument must be positive");
        if (a < DECIMALS) return (-n_log(DOUBLE_DECIMALS / a));
        int256 ans = 0;
        if (a >= a0 * DECIMALS) {
            ans += x0;
            a /= a0;
        }
        if (a >= a1 * DECIMALS) {
            ans += x1;
            a /= a1;
        }
        a *= 100;
        ans *= 100;
        if (a >= a2) {
            ans += x2;
            a = (a * PRECISION) / a2;
        }
        if (a >= a3) {
            ans += x3;
            a = (a * PRECISION) / a3;
        }
        if (a >= a4) {
            ans += x4;
            a = (a * PRECISION) / a4;
        }
        if (a >= a5) {
            ans += x5;
            a = (a * PRECISION) / a5;
        }
        if (a >= a6) {
            ans += x6;
            a = (a * PRECISION) / a6;
        }
        if (a >= a7) {
            ans += x7;
            a = (a * PRECISION) / a7;
        }
        if (a >= a8) {
            ans += x8;
            a = (a * PRECISION) / a8;
        }
        if (a >= a9) {
            ans += x9;
            a = (a * PRECISION) / a9;
        }
        if (a >= a10) {
            ans += x10;
            a = (a * PRECISION) / a10;
        }
        if (a >= a11) {
            ans += x11;
            a = (a * PRECISION) / a11;
        }
        int256 z = (PRECISION * (a - PRECISION)) / (a + PRECISION);
        int256 s = z;
        int256 z_squared = (z * z) / PRECISION;
        int256 t = (z * z_squared) / PRECISION;
        s += t / 3;
        t = (t * z_squared) / PRECISION;
        s += t / 5;
        t = (t * z_squared) / PRECISION;
        s += t / 7;
        t = (t * z_squared) / PRECISION;
        s += t / 9;
        t = (t * z_squared) / PRECISION;
        s += t / 11;
        return (ans + 2 * s) / 100;
    }

    /**
     * Computes x to the power of y for numbers with 18 decimals precision.
     * @param x Base with 18 decimal places.
     * @param y Exponent with 18 decimal places.
     * @notice Must fulfil: -41.446531673892822312  < (log(x) * y) <  130.700829182905140221
     * @return xˆy
     */
    function exp(int256 x, int256 y) internal pure returns (int256) {
        require(0 < x, "x must be positive");
        require(
            -MILD_EXPONENT_BOUND < y && y < MILD_EXPONENT_BOUND,
            "absolute value of input y has to be less than 2**254 / 10**20"
        );
        int256 logx_times_y;
        if (PRECISION_LOG_UNDER_BOUND < x && x < PRECISION_LOG_UPPER_BOUND) {
            int256 logbase = n_log_36(x);
            logx_times_y = ((logbase / DECIMALS) *
                y +
                ((logbase % DECIMALS) * y) /
                DECIMALS);
        } else {
            logx_times_y = n_log(x) * y;
        }
        require(
            EXPONENT_LB * DECIMALS <= logx_times_y &&
                logx_times_y <= EXPONENT_UB * DECIMALS,
            "log(x) times y must be between -41.446531673892822312 and 130.700829182905140221"
        );
        logx_times_y /= DECIMALS;
        return n_exp(logx_times_y);
    }

    /**
     * Computes log of a number in base of another number, both numbers with 18 decimals precision.
     * @param arg Argument with 18 decimal places.
     * @param base Base with 18 decimal places.
     * @notice Must fulfil: -41.446531673892822312  < (log(x) * y) <  130.700829182905140221
     * @return log[base](arg)
     */
    function log(int256 arg, int256 base) internal pure returns (int256) {
        int256 logbase;
        if (
            PRECISION_LOG_UNDER_BOUND < base && base < PRECISION_LOG_UPPER_BOUND
        ) {
            logbase = n_log_36(base);
        } else {
            logbase = n_log(base) * DECIMALS;
        }
        int256 logarg;
        if (
            PRECISION_LOG_UNDER_BOUND < arg && arg < PRECISION_LOG_UPPER_BOUND
        ) {
            logarg = n_log_36(arg);
        } else {
            logarg = n_log(arg) * DECIMALS;
        }
        return (logarg * DECIMALS) / logbase;
    }

    /**
     * Private function to calculate the natural logarithm of a number with 36 decimals precision.
     * @param a Positive number with 18 decimal places.
     * @return ln(x)
     */
    function n_log_36(int256 a) private pure returns (int256) {
        a *= DECIMALS;
        int256 z = (DOUBLE_DECIMALS * (a - DOUBLE_DECIMALS)) /
            (a + DOUBLE_DECIMALS);
        int256 s = z;
        int256 z_squared = (z * z) / DOUBLE_DECIMALS;
        int256 t = (z * z_squared) / DOUBLE_DECIMALS;
        s += t / 3;
        t = (t * z_squared) / DOUBLE_DECIMALS;
        s += t / 5;
        t = (t * z_squared) / DOUBLE_DECIMALS;
        s += t / 7;
        t = (t * z_squared) / DOUBLE_DECIMALS;
        s += t / 9;
        t = (t * z_squared) / DOUBLE_DECIMALS;
        s += t / 11;
        t = (t * z_squared) / DOUBLE_DECIMALS;
        s += t / 13;
        t = (t * z_squared) / DOUBLE_DECIMALS;
        s += t / 15;
        return 2 * s;
    }
}
