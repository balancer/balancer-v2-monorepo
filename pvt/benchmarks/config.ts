enum PoolType {
  WEIGHTED_POOL = 'WEIGHTED_POOL',
  MANAGED_POOL = 'MANAGED_POOL',
  STABLE_POOL = 'STABLE_POOL',
}

type PoolConfig = {
  minTokens: number;
  maxTokens: number;
};

export const poolConfigs: Record<PoolType, PoolConfig> = {
  [PoolType.WEIGHTED_POOL]: {
    minTokens: 2,
    maxTokens: 8,
  },
  [PoolType.MANAGED_POOL]: {
    minTokens: 2,
    maxTokens: 50,
  },
  [PoolType.STABLE_POOL]: {
    minTokens: 2,
    maxTokens: 5,
  },
};
