import "./arithmetic/TBFixedPoint128.sol";
import "./arithmetic/TBFixedPoint256.sol";
import "./arithmetic/TBLogExpMath.sol";

contract TestArithmetic is TBFixedPoint128, TBFixedPoint256, TBLogExpMath{
    constructor() public {
    }
}