# 2023-05-05 - Weighted Pool Factory V5

New deployment of the `WeightedPoolFactory`, which removes recursion from `LogExpMath` functions, for compatibility with zkSync. It is otherwise identical to `20230320-weighted-pool-v4`.
This also deploys the external math library `ExternalWeightedMath`.

## Useful Files

- [`WeightedPoolFactory` artifact](./artifact/WeightedPoolFactory.json)
