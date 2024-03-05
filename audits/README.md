# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Audits

This directory the reports of audits performed on Balancer smart contracts by different security firms.
See the [deployment repo](https://github.com/balancer/balancer-deployments) for all contract versions and statuses.

| :warning: | Audits are not a guarantee of correctness. Some of the contracts were modified after they were audited.      |
| --------- | :----------------------------------------------------------------------------------------------------------- |

| Scope                             | Firm          | Report                                         | Currently supported |
| --------------------------------- | ------------- | ---------------------------------------------- | ------------------- |
| Vault, Weighted Pool, Stable Pool | OpenZeppelin  | [`2021-03-15`](./openzeppelin/2021-03-15.pdf)  | Vault; Weighted V4  |
| Vault, Weighted Pool, Stable Pool | Trail Of Bits | [`2021-04-02`](./trail-of-bits/2021-04-02.pdf) | Vault; Stable V5    |
| Vault                             | Certora       | [`2021-04-22`](./certora/2021-04-22.pdf)       | Vault               |
| MultiRewards, Stable Pool         | OpenZeppelin  | [`2021-10-09`](./openzeppelin/2021-10-09.pdf)  | Deprecated          |
| Linear Pool, Stable Phantom Pool  | Trail Of Bits | [`2021-10-08`](./trail-of-bits/2021-10-08.pdf) | Deprecated          |
| Timelock Authorizer               | ABDK          | [`2022-05-27`](./abdk/2022-05-27.pdf)          | Pending deployment  |
| Batch Relayer                     | Trail Of Bits | [`2022-05-27`](./trail-of-bits/2022-05-27.pdf) | V5, V6              |
| Composable Stable Pool            | Certora       | [`2022-09-23`](./certora/2022-09-23.pdf)       | V5                  |
| Composable Stable Pool            | Trail Of Bits | [`2022-09-02`](./trail-of-bits/2022-09-02.pdf) | V5                  |
| Managed Pool                      | Trail Of Bits | [`2022-10-25`](./trail-of-bits/2022-10-25.pdf) | V2 (unused)         |
| Timelock Authorizer               | Certora       | [`2023-05-08`](./certora/2023-05-08.pdf)       | Pending deployment  |
