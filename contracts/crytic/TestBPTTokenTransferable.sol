import "./token/PropertiesBPTToken.sol";

contract TestBPTTokenTransferable is PropertiesBPTToken {
    constructor () public {
		initialTotalSupply = uint(-1);
        _mintPoolTokens(crytic_owner, initialTotalSupply/3); 
		initialBalance_owner = initialTotalSupply/3;
        _mintPoolTokens(crytic_user, initialTotalSupply/3); 
		initialBalance_user = initialTotalSupply/3;
        _mintPoolTokens(crytic_attacker, initialTotalSupply/3); 
		initialBalance_attacker = initialTotalSupply/3;
    }
}