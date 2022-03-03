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
- **usdPlus->stUsdPlus**: usdPlus->{deposit}->stUsdPlus
- **stUsdPlus->usdPlus**: stUsdPlus->{redeem}->usdPlus

---

Where:
- **usdc** - ERC20 token
- **usdPlus** - ERC20 token, rebased, 1:1 to usdc
- **stUsdPlus** - ERC4626 wrapper over usdPlus, non rebased, have exchange rate to usdPlus

 
- **{wrap}** - ERC4626Wrapping.wrapERC4626 over IERC4626.deposit
- **{unwrap}** - ERC4626Wrapping.unwrapERC4626 over IERC4626.redeem
- **{swap}** - Vault.swap
- **{deposit}** - IERC4626.deposit
- **{redeem}** - IERC4626.redeem

