### Exchanges

Swap on pool:
- **usdc -> usdPlus**: usdc->{swap}->stUsdPlus->{unwrap}->usdPlus
- **usdPlus -> usdc**: usdPlus->{wrap}->stUsdPlus->{swap}->usdc

Put in pool:
- **usdc -> lpToken**: usdc->{swap}->lpToken
- **usdPlus -> lpToken**: usdPlus->{wrap}->stUsdPlus->{swap}->lpToken

Take out from pool:
- **lpToken -> usdc**: lpToken->{swap}->usdc
- **lpToken -> usdPlus**: lpToken->{swap}->stUsdPlus->{unwrap}->usdPlus

With ERC4626:
- **usdc->stUsdPlus**: usdc->{deposit}->stUsdPlus
- **stUsdPlus->usdc**: stUsdPlus->{redeem}->usdc

Where:
- **{wrap}** - UsdPlusWrapping.wrapUsdPlusDynamicToken
- **{unwrap}** - UsdPlusWrapping.unwrapUsdPlusStaticToken
- **{swap}** - Vault.swap
- **{deposit}** - IERC4626.deposit
- **{redeem}** - IERC4626.redeem


**Note**: ERC4626 deposit and redeem functions may be used when user want to exchange 
tokens but there are not enough in the pool. Also, it is useful when pool 
need to be balanced/arbitraged.
