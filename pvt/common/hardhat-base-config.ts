type ContractSettings = Record<
  string,
  {
    version: string;
    runs: number;
  }
>;

const contractSettings: ContractSettings = {
  '@balancer-labs/v2-vault/contracts/Vault.sol': {
    version: '0.7.1',
    runs: 500,
  },
  '@balancer-labs/v2-pool-weighted/contracts/LiquidityBootstrappingPoolFactory.sol': {
    version: '0.7.1',
    runs: 200,
  },
  '@balancer-labs/v2-pool-weighted/contracts/smart/ManagedPoolFactory.sol': {
    version: '0.7.1',
    runs: 200,
  },
};

type SolcConfig = {
  version: string;
  settings: {
    optimizer: {
      enabled: boolean;
      runs?: number;
    };
  };
};

export const compilers: [SolcConfig] = [
  {
    version: '0.7.1',
    settings: {
      optimizer: {
        enabled: true,
        runs: 9999,
      },
    },
  },
];

export const overrides = (packageName: string): Record<string, SolcConfig> => {
  const overrides: Record<string, SolcConfig> = {};

  for (const contract of Object.keys(contractSettings)) {
    overrides[contract.replace(`${packageName}/`, '')] = {
      version: contractSettings[contract].version,
      settings: {
        optimizer: {
          enabled: true,
          runs: contractSettings[contract].runs,
        },
      },
    };
  }

  return overrides;
};
