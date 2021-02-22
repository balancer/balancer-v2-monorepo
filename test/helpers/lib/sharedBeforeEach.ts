import { EthereumProvider } from 'hardhat/types';

import { wrapWithTitle, takeSnapshot, revert, getProvider } from './utils';

const SNAPSHOTS: string[] = [];

/**
 * This Mocha helper acts as a `beforeEach`, but executes the initializer
 * just once. It internally uses Hardhat Network and Ganache's snapshots
 * and revert instead of re-executing the initializer.
 *
 * Note that after the last test is run, the state doesn't get reverted.
 *
 * @param title A title that's included in all the hooks that this helper uses.
 * @param initializer The initializer to be run before the tests.
 * @param provider The network provider.
 */
export function sharedBeforeEach(title: string, initializer: Mocha.AsyncFunc, provider?: EthereumProvider): void;
export function sharedBeforeEach(initializer: Mocha.AsyncFunc, provider?: EthereumProvider): void;

export function sharedBeforeEach(
  titleOrInitializer: string | Mocha.AsyncFunc,
  initializerOrProvider?: Mocha.AsyncFunc | EthereumProvider,
  optionalProvider?: EthereumProvider
): void {
  const title = typeof titleOrInitializer === 'string' ? titleOrInitializer : undefined;

  let initializer: Mocha.AsyncFunc;
  let maybeProvider: EthereumProvider | undefined;
  if (typeof titleOrInitializer === 'function') {
    initializer = titleOrInitializer;
    maybeProvider = initializerOrProvider as EthereumProvider | undefined;
  } else {
    initializer = initializerOrProvider as Mocha.AsyncFunc;
    maybeProvider = optionalProvider;
  }

  let initialized = false;

  beforeEach(wrapWithTitle(title, 'Running shared before each or reverting'), async function () {
    const provider = await getProvider(maybeProvider);
    if (!initialized) {
      const prevSnapshot = SNAPSHOTS.pop();
      if (prevSnapshot !== undefined) {
        await revert(provider, prevSnapshot);
        SNAPSHOTS.push(await takeSnapshot(provider));
      }

      await initializer.call(this);

      SNAPSHOTS.push(await takeSnapshot(provider));
      initialized = true;
    } else {
      const snapshotId = SNAPSHOTS.pop();
      if (snapshotId === undefined) throw Error('Missing snapshot ID');
      await revert(provider, snapshotId);
      SNAPSHOTS.push(await takeSnapshot(provider));
    }
  });

  after(async function () {
    if (initialized) {
      SNAPSHOTS.pop();
    }
  });
}
