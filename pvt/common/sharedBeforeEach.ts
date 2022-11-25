import { AsyncFunc } from 'mocha';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';

const SNAPSHOTS: Array<SnapshotRestorer> = [];

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
    if (!initialized) {
      const prevSnapshot = SNAPSHOTS.pop();
      if (prevSnapshot !== undefined) {
        await prevSnapshot.restore();
        SNAPSHOTS.push(await takeSnapshot());
      }

      await fn.call(this);

      SNAPSHOTS.push(await takeSnapshot());
      initialized = true;
    } else {
      const shapshot = SNAPSHOTS.pop();
      if (shapshot === undefined) throw Error('Missing sharedBeforeEach snapshot');
      await shapshot.restore();
      SNAPSHOTS.push(await takeSnapshot());
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
