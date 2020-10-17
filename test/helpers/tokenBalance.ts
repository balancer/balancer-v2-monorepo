import { Signer, Contract, BigNumber } from 'ethers';
import { TokenList } from './tokens';
import { Dictionary } from 'lodash';
import { expect } from 'chai';

// Ported from @openzeppelin/test-helpers to use with ERC20 tokens and Ethers

class ERC20BalanceTracker {
  private prev: BigNumber | undefined;

  constructor(private address: string, private token: Contract) {}

  // returns the current token balance
  async get(): Promise<BigNumber> {
    this.prev = await currentBalance(this.address, this.token);

    return this.prev;
  }

  // returns the balance difference between the current one and the
  // last call to get or delta
  async delta(): Promise<BigNumber> {
    const balance = await currentBalance(this.address, this.token);

    if (this.prev == undefined) {
      throw new Error('Tracker.get must be called before Tracker.delta');
    }

    const delta = balance.sub(this.prev);
    this.prev = balance;

    return delta;
  }
}

type Account = string | Signer;

async function accountToAddress(account: Account): Promise<string> {
  return typeof account == 'string' ? account : await account.getAddress();
}

// Creates an initializes a balance tracker. Constructors cannot be async (and therefore get cannot
// be called there), so we have this helper method.
export async function balanceTracker(account: Account, token: Contract): Promise<ERC20BalanceTracker> {
  const tracker = new ERC20BalanceTracker(await accountToAddress(account), token);
  await tracker.get();
  return tracker;
}

// Returns an account's balance in a token
export async function currentBalance(account: Account, token: Contract): Promise<BigNumber> {
  return token.balanceOf(await accountToAddress(account));
}

type BigNumberish = string | number | BigNumber;

type CompareFunction = 'equal' | 'eq' | 'above' | 'gt' | 'gte' | 'below' | 'lt' | 'lte' | 'least' | 'most';
type Comparison = [CompareFunction, BigNumberish];

// Measures the ERC20 balance of an account for multiple tokens before and after an async operation (which
// presumably involves Ethereum transactions), and then compares the deltas to a list of expected changes.
// `tokens` can be obtained by calling `tokens.deployTokens`. Any token not specified in `balanceChanges`
// is expected to have no balance change.
//
// Sample usage, trading 50 USDC in exchange for 50 DAI
//
// await expectBalanceChange(async () => {
//   await uniswap.swap('USDC', 'DAI', 50);
// }, account, tokens, { 'DAI': 50, 'USDC': -50 });
// });
//
// Checks other than equality can also be performed by passing a comparison and value tuple.
//
// await expectBalanceChange(async () => {
//   await uniswap.swap('USDC', 'DAI', 50);
// }, account, tokens, { 'DAI': 50, 'USDC': -50, 'UNI': ['gt', 0] }); // Earn an unknown amount of UNI
// });
export async function expectBalanceChange(
  promise: () => Promise<void>,
  account: Account,
  tokens: TokenList,
  balanceChanges: Dictionary<BigNumberish | Comparison>
): Promise<void> {
  const trackers: Dictionary<ERC20BalanceTracker> = {};

  for (const symbol in tokens) {
    const token = tokens[symbol];
    trackers[symbol] = await balanceTracker(account, token);
  }

  await promise();

  for (const symbol in tokens) {
    const delta = await trackers[symbol].delta();

    const change = balanceChanges[symbol];
    if (change === undefined) {
      expect(delta).to.equal(0);
    } else {
      const compare: CompareFunction = Array.isArray(change) ? change[0] : 'equal';
      const value: BigNumberish = Array.isArray(change) ? change[1] : change;

      expect(delta).to[compare](value.toString());
    }
  }
}
