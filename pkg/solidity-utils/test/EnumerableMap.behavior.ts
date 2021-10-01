import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { zip } from 'lodash';

export function shouldBehaveLikeMap(
  store: { map: Contract },
  keys: Array<string | BigNumber>,
  values: Array<string | BigNumber>
): void {
  const [keyA, keyB, keyC] = keys;
  const [valueA, valueB, valueC] = values;

  const indexOfErrorCode = 41;
  const getErrorCode = 42;

  async function expectMembersMatch(map: Contract, keys: Array<string | BigNumber>, values: Array<string | BigNumber>) {
    expect(keys.length).to.equal(values.length);

    await Promise.all(keys.map(async (key) => expect(await map.contains(key)).to.equal(true)));

    expect(await map.length()).to.equal(keys.length.toString());

    expect(await Promise.all(keys.map((key) => map.get(key, getErrorCode)))).to.deep.equal(values);

    // To compare key-value pairs, we zip keys and values, and convert BNs to
    // strings to workaround Chai limitations when dealing with nested arrays
    expect(
      await Promise.all(
        [...Array(keys.length).keys()].map(async (index) => {
          const entryAt = await map.at(index);
          const entryAtUnchecked = await map.unchecked_at(index);
          const valueAtUnchecked = await map.unchecked_valueAt(index);

          expect(entryAt.key).to.equal(entryAtUnchecked.key);
          expect(entryAt.value).to.equal(entryAtUnchecked.value);
          expect(entryAt.value).to.equal(valueAtUnchecked);

          return [entryAt.key.toString(), entryAt.value];
        })
      )
    ).to.have.same.deep.members(
      zip(
        keys.map((k) => k.toString()),
        values
      )
    );
  }

  it('starts empty', async () => {
    expect(await store.map.contains(keyA)).to.equal(false);

    await expectMembersMatch(store.map, [], []);
  });

  describe('set', () => {
    it('adds a key', async () => {
      const receipt = await (await store.map.set(keyA, valueA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

      await expectMembersMatch(store.map, [keyA], [valueA]);
    });

    it('adds several keys', async () => {
      await store.map.set(keyA, valueA);
      await store.map.set(keyB, valueB);

      await expectMembersMatch(store.map, [keyA, keyB], [valueA, valueB]);
      expect(await store.map.contains(keyC)).to.equal(false);
    });

    it('returns false when adding keys already in the set', async () => {
      await store.map.set(keyA, valueA);

      const receipt = await (await store.map.set(keyA, valueA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: false });

      await expectMembersMatch(store.map, [keyA], [valueA]);
    });

    it('updates values for keys already in the set', async () => {
      await store.map.set(keyA, valueA);

      await store.map.set(keyA, valueB);

      await expectMembersMatch(store.map, [keyA], [valueB]);
    });
  });

  describe('get', () => {
    it('returns the value for a key', async () => {
      await store.map.set(keyA, valueA);

      expect(await store.map.get(keyA, getErrorCode)).to.equal(valueA);
    });

    it('reverts with a custom message if the key is not in the map', async () => {
      await expect(store.map.get(keyA, getErrorCode)).to.be.revertedWith(getErrorCode.toString());
    });
  });

  describe('indexOf', () => {
    it('returns the index of an added key', async () => {
      await store.map.set(keyA, valueA);
      await store.map.set(keyB, valueB);

      expect(await store.map.indexOf(keyA, indexOfErrorCode)).to.equal(0);
      expect(await store.map.indexOf(keyB, indexOfErrorCode)).to.equal(1);
    });

    it('adding and removing keys can change the index', async () => {
      await store.map.set(keyA, valueA);
      await store.map.set(keyB, valueB);

      await store.map.remove(keyA);

      // B is now the only element; its index must be 0
      expect(await store.map.indexOf(keyB, indexOfErrorCode)).to.equal(0);
    });

    it('reverts if the key is not in the map', async () => {
      await expect(store.map.indexOf(keyA, indexOfErrorCode)).to.be.revertedWith(indexOfErrorCode.toString());
    });
  });

  describe('unchecked_indexOf', () => {
    it('returns the index of an added key, plus one', async () => {
      await store.map.set(keyA, valueA);
      await store.map.set(keyB, valueB);

      expect(await store.map.unchecked_indexOf(keyA)).to.equal(0 + 1);
      expect(await store.map.unchecked_indexOf(keyB)).to.equal(1 + 1);
    });

    it('adding and removing keys can change the index', async () => {
      await store.map.set(keyA, valueA);
      await store.map.set(keyB, valueB);

      await store.map.remove(keyA);

      // B is now the only element; its index must be 0
      expect(await store.map.unchecked_indexOf(keyB)).to.equal(0 + 1);
    });

    it('returns a zero index if the key is not in the map', async () => {
      expect(await store.map.unchecked_indexOf(keyA)).to.be.equal(0);
    });
  });

  describe('unchecked_setAt', () => {
    it('updates a value', async () => {
      await store.map.set(keyA, valueA);

      const indexA = (await store.map.unchecked_indexOf(keyA)) - 1;
      await store.map.unchecked_setAt(indexA, valueB);

      await expectMembersMatch(store.map, [keyA], [valueB]);
    });

    it('updates several values', async () => {
      await store.map.set(keyA, valueA);
      await store.map.set(keyB, valueB);

      const indexA = (await store.map.unchecked_indexOf(keyA)) - 1;
      const indexB = (await store.map.unchecked_indexOf(keyB)) - 1;

      await store.map.unchecked_setAt(indexA, valueC);
      await store.map.unchecked_setAt(indexB, valueA);

      await expectMembersMatch(store.map, [keyA, keyB], [valueC, valueA]);
    });

    it('does not revert when setting indexes outside of the map', async () => {
      const length = await store.map.length();
      await store.map.unchecked_setAt(length, valueC);
    });
  });

  describe('unchecked_at', () => {
    it('returns an entry at an index', async () => {
      await store.map.set(keyA, valueA);

      const indexA = (await store.map.unchecked_indexOf(keyA)) - 1;
      const entry = await store.map.unchecked_at(indexA);

      expect(entry.key).to.equal(keyA);
      expect(entry.value).to.equal(valueA);
    });

    it('does not revert when accessing indexes outside of the map', async () => {
      const length = await store.map.length();
      await store.map.unchecked_at(length);
    });
  });

  describe('unchecked_valueAt', () => {
    it('returns a value at an index', async () => {
      await store.map.set(keyA, valueA);

      const indexA = (await store.map.unchecked_indexOf(keyA)) - 1;
      const value = await store.map.unchecked_valueAt(indexA);

      expect(value).to.equal(valueA);
    });

    it('does not revert when accessing indexes outside of the map', async () => {
      const length = await store.map.length();
      await store.map.unchecked_valueAt(length);
    });
  });

  describe('remove', () => {
    it('removes added keys', async () => {
      await store.map.set(keyA, valueA);

      const receipt = await (await store.map.remove(keyA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

      expect(await store.map.contains(keyA)).to.equal(false);
      await expectMembersMatch(store.map, [], []);
    });

    it('returns false when removing keys not in the set', async () => {
      const receipt = await (await store.map.remove(keyA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: false });

      expect(await store.map.contains(keyA)).to.equal(false);
    });

    it('adds and removes multiple keys', async () => {
      // []

      await store.map.set(keyA, valueA);
      await store.map.set(keyC, valueC);

      // [A, C]

      await store.map.remove(keyA);
      await store.map.remove(keyB);

      // [C]

      await store.map.set(keyB, valueB);

      // [C, B]

      await store.map.set(keyA, valueA);
      await store.map.remove(keyC);

      // [A, B]

      await store.map.set(keyA, valueA);
      await store.map.set(keyB, valueB);

      // [A, B]

      await store.map.set(keyC, valueC);
      await store.map.remove(keyA);

      // [B, C]

      await store.map.set(keyA, valueA);
      await store.map.remove(keyB);

      // [A, C]

      await expectMembersMatch(store.map, [keyA, keyC], [valueA, valueC]);

      expect(await store.map.contains(keyB)).to.equal(false);
    });
  });
}
