import "../../math/FixedPoint.sol";
pragma solidity ^0.7.1;

contract TBFixedPoint128 {
    uint128 internal uint128_x1;
    uint128 internal uint128_x2;
    uint128 internal uint128_x3;
    uint128 internal UINT128_ZERO = 0;
    uint128 internal UINT128_ONE = 1;

    function set_x1_uint128(uint128 _x1) public returns (bool){
        uint128_x1 = _x1;
    }
    function set_x2_uint128(uint128 _x2) public returns (bool) {
        uint128_x2 = _x2;
    }
    function set_x3_uint128(uint128 _x3) public returns (bool) {
        uint128_x3 = _x3;
    }
    function delta(uint128 _a, uint128 _b) public pure returns (uint128) {
        if (_a >= _b) {
            return _a - _b;
        } else {
            return _b - _a;
        }
    }

    function equalWithTolerance(uint128 x, uint128 y, uint128 epsilon) internal pure returns (bool) {
        return (delta(x,y) <= epsilon);
    }

    function echidna_sub128_zero_identity() public returns (bool) {
        uint128 r1 = FixedPoint.sub128(uint128_x1,UINT128_ZERO);
        return r1 == uint128_x1;
    }

    function echidna_sub128_self() public returns (bool) {
        uint128 r1 = FixedPoint.sub128(uint128_x1,uint128_x1);
        return r1 == UINT128_ZERO;
    }

    function echidna_add128_commutative() public returns (bool) {
        uint128 max = uint128(-1)/2;
        if (uint128_x1 >= max || uint128_x2 >= max) {
            return true;
        }
        uint128 r1 = FixedPoint.add128(uint128_x1,uint128_x2); // uint128_x1 + uint128_x2
        uint128 r2 = FixedPoint.add128(uint128_x2,uint128_x1); // uint128_x2 + uint128_x1
        return r1 == r2; // uint128_x1 + uint128_x2 == uint128_x2 + uint128_x1
    }

    function echidna_add128_associative() public returns (bool) {
        uint128 max_uint128 = uint128(-1)/3;
        if (uint128_x1 >= max_uint128 || uint128_x2 >= max_uint128 || uint128_x3 >= max_uint128) {
            return true;
        }
        uint128 r1 = FixedPoint.add128(uint128_x1,FixedPoint.add128(uint128_x2,uint128_x3)); // uint128_x1 + (uint128_x2 + uint128_x3)
        uint128 r2 = FixedPoint.add128(FixedPoint.add128(uint128_x1,uint128_x2),uint128_x3); // (uint128_x1 + uint128_x2) + uint128_x3
        return r1 == r2; // uint128_x1 + (uint128_x2 + uint128_x3)  == (uint128_x1 + uint128_x2) + uint128_x3
    }

    function echidna_add128_zero_identity() public returns (bool) {
        uint128 r1 = FixedPoint.add128(uint128_x1,UINT128_ZERO);
        return r1 == uint128_x1;
    }
    
    function echidna_mul128_zero() public returns (bool) {
        uint128 r1 = FixedPoint.mul128(uint128_x1,UINT128_ZERO);
        return r1 == UINT128_ZERO;
    }

    function echidna_mul128_commutative() public returns (bool) { 
        uint64 max = uint64(-1)/2;
        if (uint128_x1 >= max || uint128_x2 >= max) {
            return true;
        }
        uint128 r1 = FixedPoint.mul128(uint128_x1,uint128_x2);
        uint128 r2 = FixedPoint.mul128(uint128_x2,uint128_x1);
        return r1 == r2;
    }
    
    function echidna_mul128_one() public returns (bool) {
        uint128 r1 = FixedPoint.mul128(uint128_x1,UINT128_ONE);
        return r1 == uint128_x1;
    }

    function echidna_mul128_is_2add() public returns (bool) {
        uint128 r1 = FixedPoint.mul128(2,uint128_x1);
        uint128 r2 = FixedPoint.add128(uint128_x1,uint128_x1);
        return r1 == r2;
    }

}