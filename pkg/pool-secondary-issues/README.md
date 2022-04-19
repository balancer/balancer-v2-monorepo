# Primary issue pools

The Primary Issue pool enables price discovery for assets in the pool. For example, new issues for security tokens start with a floor price set by the issuer and a price range that market makers accept. New issues are also open for a term after which the issuer allots underlying securities to investors. Till the new issue is open, investors may swap tokens with the security token pool till they reach a price point at which they want to seek allotment of underlying securities from the issuer. 

Each new issue of security tokens creates a Primary issue pool comprising of a security token and another token, usually a stablecoin. Each Primary issue pool is a 2-token pool. In a Primary issue pool, the security token is issued by an issuer and is backed by a real world asset such as a share or bond that provides a return on investment to the investors in the pool. The issuer therefore contributes only one asset in a 2-token pool. The other token in the pair can be contributed by a market maker (BalancerManager.sol).

Once the new issue has closed, the issuer accepts investments in the pool for a price point or a range of price points. Assets swapped in by investors in that price range are automatically converted to fiat currencies off chain and paid into the issuer against which underlying assets of the security token in any new issue are transferred to the investors. Investors whose bids for new issues are successful are alloted security tokens (secondary issue) that represent alloted securities. Investors whose bids for new issues are rejected by the issuer are refunded assets swapped into the Primary issue pool. Investors can continue to trade secondary issues in Balancer 2-token pools and security token holders in secondary issue pools earn income from underlying assets (shares, bonds) they hold. Swaps in secondary issue pools give new investors the option to take delivery of underlying assets at which time underlying assets are transferred from prinary investors to secondary investors by the issuer.  

## Features of the Primary issue pool

1. Single sided liquidity : Issuers can contribute only securities. Market makers can contribute only other tokens to pair securities with in the pool.
2. Asset management : the Balancer Manager contract creates the primary issue pools, registers tokens (securities + their paired tokens) in the pool, withdraw assets from the pool for allotment by issuers, refunds for investor bids that are not accepted, and creation of secondary issue pools for alloted securities.
3. Price band for book building : Issuers and market makers can specify what they are offering and what they can accept. This helps set a floor price for new issues, define a price band against which investors can swap in assets.
4. Investment bids : the Balancer Manager contract (common for all issues and is fixed) withdraws investments from the pool and makes it possible for offchain logic to subscribe for delivery of securities to investors in the pool.
5. Managing allotments : refunds and transfer of alloted securities to investors are managed by the Balancer Manager contract.




