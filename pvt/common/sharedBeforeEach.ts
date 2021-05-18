import { AsyncFunc } from 'mocha';

import { takeSnapshot, revert, getProvider } from './network';

const SNAPSHOTS: string[] = [];

/**
 * This Mocha helper acts as a `beforeEach`, but executes the initializer
 * just once. It internally uses Hardhat Network and Ganache's snapshots
 * and revert instead of re-executing the initializer.
 *
 * Note that after the last test is run, the state doesn't get reverted.
 *
 * @param nameOrFn A title that's included in all the hooks that this helper uses.
 * @param maybeFn The initializer to be run before the tests.
 */
export function sharedBeforeEach(nameOrFn: string | AsyncFunc, maybeFn?: AsyncFunc): void {
  const name = typeof nameOrFn === 'string' ? nameOrFn : undefined;
  const fn = typeof nameOrFn === 'function' ? nameOrFn : (maybeFn as AsyncFunc);

  let initialized = false;

  beforeEach(wrapWithTitle(name, 'Running shared before each or reverting'), async function () {
    const provider = await getProvider();
    if (!initialized) {
      const prevSnapshot = SNAPSHOTS.pop();
      if (prevSnapshot !== undefined) {
        await revert(provider, prevSnapshot);
        SNAPSHOTS.push(await takeSnapshot(provider));
      }

      await fn.call(this);

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

function wrapWithTitle(title: string | undefined, str: string): string {
  return title === undefined ? str : `${title} at step "${str}"`;
}
