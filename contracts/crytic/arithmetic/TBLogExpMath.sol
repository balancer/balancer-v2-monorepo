pragma solidity ^0.7.1;

import "../../math/LogExpMath.sol";

contract TBLogExpMath {
    int256 a = 0;

    function setA(int256 _a) public {
        a = _a;
    }

    function delta(int256 _a, int256 _b) public pure returns (int256) {
        if (_a >= _b) {
            return _a - _b;
        } else {
            return _b - _a;
        }
    }

    function isclose(int256 _a, int256 _b, int256 epsilon) public pure returns (bool) {
        return delta(_a, _b) <= epsilon;
    }

    function echidna_log_of_exp_of_x_equals_x() public view returns (bool) {
        // give `a` 18 digits additional precision
        int256 a_precise = a * 10**18;

        // "Natural exp argument must be between -41.446531673892822312 and 130.700829182905140221"
        // source: LogExpMath.sol
        if (a_precise < LogExpMath.EXPONENT_LB) {
            return true;
        }
        if (a_precise > LogExpMath.EXPONENT_UB) {
            return true;
        }
        int256 exp = LogExpMath.n_exp(a_precise);
        int256 log = LogExpMath.n_log(exp);

        return isclose(a_precise, log, 10**1);
    }

    function echidna_exp_of_log_of_x_equals_x() public view returns (bool) {
        // give `a` 18 digits additional precision
        int256 a_precise = a * 10**18;

        // "Natural log argument must be positive");
        // source: LogExpMath.sol
        if (a_precise <= 0) {
            return true;
        }
        int256 log = LogExpMath.n_log(a_precise);

        // "Natural exp argument must be between -41.446531673892822312 and 130.700829182905140221"
        // source: LogExpMath.sol
        if (a_precise < LogExpMath.EXPONENT_LB) {
            return true;
        }
        if (a_precise > LogExpMath.EXPONENT_UB) {
            return true;
        }
        int256 exp = LogExpMath.n_exp(log);

        return isclose(a_precise, exp, 10**2);
    }
}