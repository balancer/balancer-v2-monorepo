// Verified Asset manager interface for Balancer security token pool
//"SPDX-License-Identifier: MIT"

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

interface IMarketMaker {

    // a token contributed to the primary issue pool has an 'owner' which could be the tokenized securities issuer or market maker
    // the token contributor offers the 'amountOffered' of the token, the 'offered' token could be the security issued or the settlement token (eg, stablecoin) it is paired with
    // the token contributor specifies the 'amountDesired' of the liquidity token that is paired to the offered token 
    // if the token contributor is a securities issuer, it specifies the 'min' size of an investor's or market maker's bid for security tokens offered
    // if the token contributor is a market maker, it specifies the 'min' size of an issuer's offer for settlement tokens bid for the issuer's offer 
    // isin is the security token identifier
    struct token{
        address owner;
        uint amountOffered;
        uint amountDesired;
        uint min;
        bytes32 isin;
    }

    struct lp{
        address owner;
        address tokenOffered;
        uint underwritten;
        uint subscribed;
        uint earned;
    }

    struct subscriptions{
        address investor;
        address asset;
        bytes32 name;
        uint256 amount;   
        uint256 price;     
    }
    
    function offer(address owned, bytes32 isin, uint offered, address tomatch, uint desired, uint min) external;

    function getOffered(address offered) external view returns(token[] memory);

    function issue(address security, uint256 cutoffTime) external;

    function subscribe(bytes32 poolId, address security, address assetIn, bytes32 assetName, uint256 amount, address investor, uint256 price) external;

    function close(address security) external returns(bytes32[] memory, bool);

    function getSubscribers(bytes32 poolId) external returns(subscriptions[] memory);

    function accept(bytes32 poolId, address investor, uint256 amount, address asset) external;

    function reject(bytes32 poolId, address investor) external;

    function settle(bytes32 poolId) external;

    function getLiquidityProviders(address _security) external returns(lp[] memory);

    function getOfferMade(address _owned, address _tomatch) external view returns(token[] memory);

}