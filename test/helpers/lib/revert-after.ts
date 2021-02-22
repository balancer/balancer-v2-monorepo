import { EthereumProvider } from 'hardhat/types';

import { wrapWithTitle, takeSnapshot, revert, getProvider } from './utils';

/**
 * ThisMocha helper reverts all your state modifications in an `after` hook.
 *
 * @param title A title that's included in all the hooks that this helper uses.
 * @param provider The network provider.
 */
export function revertAfter(title?: string, provider?: EthereumProvider) {
  let snapshotId: string | undefined;
  before(wrapWithTitle(title, 'resetAfter: taking snapshot'), async function () {
    snapshotId = await takeSnapshot(await getProvider(provider));
  });

  after(wrapWithTitle(title, 'resetAfter: reverting state'), async function () {
    if (snapshotId !== undefined) {
      await revert(await getProvider(provider), snapshotId);
    }
  });
}
