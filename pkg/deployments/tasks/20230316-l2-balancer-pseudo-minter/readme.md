# 2023-03-16 - L2 Balancer Pseudo Minter

Deployment of the `L2BalancerPseudoMinter`, which distributes bridged BAL tokens on networks other than Mainnet and keeps track of the rewards that have already been distributed for each user.
It is analogous to the `BalancerMinter` deployed to Mainnet as part of the [Gauge Controller deployment](../20220325-gauge-controller/output/mainnet.json), providing a similar user interface.
The main difference between the two is that the pseudo minter does not actually mint tokens; it just distributes bridged tokens instead.

## Useful Files

- [`L2BalancerPseudoMinter` artifact](./artifact/L2BalancerPseudoMinter.json)
