import Task, { TaskMode } from '../../src/task';

export type OptimismRootGaugeFactoryDeployment = {
  Vault: string;
  BalancerMinter: string;
  OptimismBAL: string;
  L1StandardBridge: string;
  GasLimit: number;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  mainnet: {
    Vault,
    BalancerMinter,
    // There is no strictly canonical BAL on Optimism (The bridge supports a one-to-many L1-to-L2 tokens relationship)
    // so we can't read this from onchain. This token holds all of Optimism's BAL TVL currently.
    // https://optimistic.etherscan.io/token/0xFE8B128bA8C78aabC59d4c64cEE7fF28e9379921
    OptimismBAL: '0xFE8B128bA8C78aabC59d4c64cEE7fF28e9379921',
    // Can't find a source for this but its BAL holding match up with the total supply of BAL on Optimism.
    L1StandardBridge: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1',
    // This value is the current maximum amount of gas which doesn't trigger the spam prevention mechanism.
    // https://github.com/ethereum-optimism/optimism/blob/68fc3fed54390ab42e5444c0091a6231fb5191c4/packages/contracts/contracts/L1/rollup/CanonicalTransactionChain.sol#L38
    // Value can be read at: https://etherscan.io/address/0x5e4e65926ba27467555eb562121fac00d24e9dd2#readContract
    GasLimit: 1920000,
  },
};
