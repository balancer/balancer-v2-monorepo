import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { shouldBehaveLikeMap } from './EnumerableMap.behavior';
import { bn } from '../../../pvt/helpers/src/numbers';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('EnumerableMap', () => {
  describe('EnumerableIERC20ToBytes32Map', () => {
    const keys = [
      '0x8B40ECf815AC8d53aB4AD2a00248DE77296344Db',
      '0x638141Eb8905D9A55D81610f45bC2B47120059e7',
      '0x7571A57e94F046725612f786Aa9bf44ce6b56894',
    ];

    const values = [
      '0x41b1a0649752af1b28b3dc29a1556eee781e4a4c3a1f7f53f90fa834de098c4d',
      '0x435cd288e3694b535549c3af56ad805c149f92961bf84a1c647f7d86fc2431b4',
      '0xf2d05ec5c5729fb559780c70a93ca7b4ee2ca37f64e62fa31046b324f60d9447',
    ];

    const store: { map?: Contract } = {};

    sharedBeforeEach(async () => {
      store.map = await deploy('EnumerableIERC20ToBytes32MapMock');
    });

    shouldBehaveLikeMap(store as { map: Contract }, keys, values);
  });

  describe('EnumerableIERC20ToUint256Map', () => {
    const keys = [
      '0x8B40ECf815AC8d53aB4AD2a00248DE77296344Db',
      '0x638141Eb8905D9A55D81610f45bC2B47120059e7',
      '0x7571A57e94F046725612f786Aa9bf44ce6b56894',
    ];

    const values = [bn(42), bn(1337), bn(9999)];

    const store: { map?: Contract } = {};

    sharedBeforeEach(async () => {
      store.map = await deploy('EnumerableIERC20ToUint256MapMock');
    });

    shouldBehaveLikeMap(store as { map: Contract }, keys, values);
    shouldHandleSetIndex(store as { map: Contract }, keys, values);

    async function keyValuesMatch(
      store: { map: Contract },
      keys: Array<string | BigNumber>,
      values: Array<string | BigNumber>,
      indexOfErrorCode: number
    ): Promise<void> {
      // Keys are all present
      await Promise.all(keys.map(async (key) => expect(await store.map.contains(key)).to.equal(true)));
      // Key values match
      expect(await Promise.all(keys.map((key) => store.map.get(key, indexOfErrorCode)))).to.deep.equal(values);
      // Keys are in correct order
      await Promise.all(keys.map(async (key, i) => expect(await store.map.indexOf(key, indexOfErrorCode)).to.equal(i)));
    }

    function shouldHandleSetIndex(
      store: { map: Contract },
      keys: Array<string | BigNumber>,
      values: Array<string | BigNumber>
    ): void {
      describe('setIndex', () => {
        const [keyA, keyB, keyC] = keys;
        const [valueA, valueB, valueC] = values;

        const keyD = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
        const valueD = '0';

        const indexOfErrorCode = 50;

        sharedBeforeEach(async () => {
          await store.map.set(keyA, valueA);
          await store.map.set(keyB, valueB);
          await store.map.set(keyC, valueC);
        });

        it('reverts if index is invalid', async () => {
          await expect(store.map.setIndex(keyA, values.length, indexOfErrorCode)).to.be.revertedWith(
            indexOfErrorCode.toString()
          );
        });

        it('returns false if the key is not present', async () => {
          const receipt = await (await store.map.setIndex(ZERO_ADDRESS, 1, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: false });
        });

        it('returns true and makes no changes if new index = old index', async () => {
          const receipt = await (await store.map.setIndex(keyA, 0, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          await keyValuesMatch(store, keys, values, indexOfErrorCode);
        });

        it('can reverse order by setting first to index of last', async () => {
          // Old order: A -> 0, B -> 1, C -> 2 (0-based token indices)
          // New order: A -> 2 B -> 1, C -> 0
          const receipt = await (await store.map.setIndex(keyA, 2, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          await keyValuesMatch(store, keys.reverse(), values.reverse(), indexOfErrorCode);
        });

        it('can change order another way', async () => {
          // Old order: A -> 0, B -> 1, C -> 2 (0-based token indices)
          // New order: A -> 0 B -> 2, C -> 1
          const receipt = await (await store.map.setIndex(keyB, 2, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          await keyValuesMatch(store, [keyA, keyC, keyB], [valueA, valueC, valueB], indexOfErrorCode);
        });

        it('adjusts to adding a token in the middle', async () => {
          // Old order: A -> 0, B -> 1, C -> 2
          // New order: A -> 0, D -> 1, B -> 2, C -> 3
          let receipt = await (await store.map.set(keyD, valueD)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          receipt = await (await store.map.setIndex(keyA, 0, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          receipt = await (await store.map.setIndex(keyD, 1, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          receipt = await (await store.map.setIndex(keyC, 2, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          receipt = await (await store.map.setIndex(keyB, 3, indexOfErrorCode)).wait();
          expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

          await keyValuesMatch(store, [keyA, keyD, keyC, keyB], [valueA, valueD, valueC, valueB], indexOfErrorCode);
        });
      });
    }
  });
});
