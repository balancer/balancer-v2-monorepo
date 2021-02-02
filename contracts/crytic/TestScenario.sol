import "./interfaces.sol";
import "./scenarios/PropertiesJoinExit.sol";
import "./scenarios/PropertiesSwap.sol";
import "./scenarios/PropertiesStablecoinMath.sol";
import "./scenarios/PropertiesPoolId.sol";
contract TestScenario is CryticInterface, PropertiesJoinExit, PropertiesSwap, PropertiesStablecoinMath, PropertiesPoolId{

}
