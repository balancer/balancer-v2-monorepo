
contract CryticInterface{
    address internal crytic_owner = address(0x627306090abaB3A6e1400e9345bC60c78a8BEf57);
    address internal crytic_user = address(0xf17f52151EbEF6C7334FAD080c5704D77216b732);
    address internal crytic_attacker = address(0x111);
    uint internal initialTotalSupply;
    uint internal initialBalance_owner;
    uint internal initialBalance_user;
    uint internal initialBalance_attacker;

    address internal authorizer = 0x1dC4c1cEFEF38a777b15aA20260a54E584b16C48;
    address internal vault = 0x1D7022f5B17d2F8B695918FB48fa1089C9f85401;
    address internal im1 = 0xA8dDa8d7F5310E4A9E24F8eBA77E091Ac264f872;
    address internal im2 =  0x06cEf8E666768cC40Cc78CF93d9611019dDcB628;
    address internal creator =  0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb;
    address internal lp =  0xE36Ea790bc9d7AB70C55260C66D52b1eca985f84;
    address internal dai =  0x0B1ba0af832d7C05fD64161E0Db78E85978E8082;
    address internal mkr =  0x871DD7C2B4b25E1Aa18728e9D5f2Af4C4e431f5c;
    address internal simplifiedPool = 0x10aDd991dE718a69DeC2117cB6aA28098836511B;
}
interface HasBalance{
    function balanceOf(address) external returns (uint256);
}
