// SPDX-License-Identifier: GPL-3.0-or-later

import "../../lib/math/FixedPoint.sol";
import "../../lib/math/LogExpMath.sol";
import "../../lib/math/Math.sol";

pragma solidity ^0.7.1;

contract TBFixedPoint256 {
    uint256 internal uint256_1;
    uint256 internal uint256_2;
    uint256 internal uint256_3;

    uint256 internal UINT256_ZERO = 0;
    uint256 internal UINT256_ONE = 1;

    constructor() {}

    function set_x1_uint256(uint256 _x1) public returns (bool) {
        uint256_1 = _x1;
    }

    function set_x2_uint256(uint256 _x2) public returns (bool) {
        uint256_2 = _x2;
    }

    function set_x3_uint256(uint256 _x3) public returns (bool) {
        uint256_3 = _x3;
    }

    function delta(uint256 _a, uint256 _b) public pure returns (uint256) {
        if (_a >= _b) {
            return _a - _b;
        } else {
            return _b - _a;
        }
    }

    function equalWithTolerance(
        uint256 x,
        uint256 y,
        uint256 epsilon
    ) internal pure returns (bool) {
        return (delta(x, y) <= epsilon);
    }

    function echidna_sub256_zero_identity() public view returns (bool) {
        uint256 r1 = FixedPoint.sub(uint256_1, UINT256_ZERO);
        return r1 == uint256_1;
    }

    function echidna_sub256_self() public view returns (bool) {
        uint256 r1 = FixedPoint.sub(uint256_1, uint256_1);
        return r1 == UINT256_ZERO;
    }

    function echidna_add256_commutative() public view returns (bool) {
        uint256 max = uint128(-1) / 3;
        if (uint256_1 >= max || uint256_2 >= max || uint256_3 >= max) {
            return true;
        }
        uint256 r1 = FixedPoint.add(uint256_1, uint256_2); // uint256_1 + uint256_2
        uint256 r2 = FixedPoint.add(uint256_2, uint256_1); // uint256_2 + uint256_1
        return r1 == r2; // uint256_1 + uint256_2 == uint256_2 + uint256_1
    }

    function echidna_add256_associative() public view returns (bool) {
        uint256 max = uint128(-1)/3;
        if (uint256_1 >= max || uint256_2 >= max || uint256_3 >= max) {
            return true;
        }
        uint256 r1 = FixedPoint.add(uint256_1, FixedPoint.add(uint256_2, uint256_3)); // uint256_1 + (uint256_2 + uint256_3)
        uint256 r2 = FixedPoint.add(FixedPoint.add(uint256_1, uint256_2), uint256_3); // (uint256_1 + uint256_2) + uint256_3
        return r1 == r2; // uint256_1 + (uint256_2 + uint256_3)  == (uint256_1 + uint256_2) + uint256_3
    }

    function echidna_add256_zero_identity() public view returns (bool) {
        uint256 r1 = FixedPoint.add(uint256_1, UINT256_ZERO);
        return r1 == uint256_1;
    }

    function echidna_mul256_zero() public view returns (bool) {
        uint256 r1 = FixedPoint.mul(uint256_1, UINT256_ZERO);
        return r1 == UINT256_ZERO;
    }

    function echidna_mul256_commutative() public view returns (bool) {
        uint256 max = uint128(-1) / 2;
        if (uint256_1 >= max || uint256_2 >= max) {
            return true;
        }
        uint256 r1 = FixedPoint.mul(uint256_1, uint256_2);
        uint256 r2 = FixedPoint.mul(uint256_2, uint256_1);
        return r1 == r2;
    }

    function echidna_mul256_one() public view returns (bool) {
        uint256 r1 = FixedPoint.mul(uint256_1, UINT256_ONE);
        return r1 == uint256_1;
    }

    function echidna_mul256_is_2add() public view returns (bool) {
        uint256 r1 = FixedPoint.mul(2, uint256_1);
        uint256 r2 = FixedPoint.add(uint256_1, uint256_1);
        return r1 == r2;
    }

    function echidna_powi_mul2() public view returns (bool) {
        if (uint256_1 == 1 || uint256_1 >= uint128(-1)) {
            return true;
        }
        uint256 r1 = LogExpMath.pow(uint256_1, 2);
        uint256 r2 = FixedPoint.mul(uint256_1, uint256_1);
        return r1 == r2;
    }

    function echidna_powi_mul3() public view returns (bool) {
        if (uint256_1 >= uint64(-1)) {
            return true;
        }
        uint256 r1 = LogExpMath.pow(uint256_1, 3);
        uint256 r2 = FixedPoint.mul(uint256_1, FixedPoint.mul(uint256_1, uint256_1));
        return r1 == r2;
    }

    function echidna_powi_sqrt_mul() public view returns (bool) {
        uint256 rx1 = Math.sqrt(uint256_1);

        uint256 r1 = FixedPoint.mul(rx1, rx1);

        return equalWithTolerance(uint256_1, r1, 10 * 8);
    }

    function echidna_sqrt_precision() public view returns (bool){
        if (uint256_1 == 0) {
            return true;
        }
        uint256 s = Math.sqrt(uint256_1);

        if (s * s > uint256_1) {
            return false;
        }

        if ((s + 1) * (s + 1) <= uint256_1) {
            return false;
        }
    }
}
