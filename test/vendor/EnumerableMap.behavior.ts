import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { zip } from 'lodash';

export function shouldBehaveLikeMap(
  store: { map: Contract },
  keys: Array<string | BigNumber>,
  values: Array<string | BigNumber>
): void {
  const [keyA, keyB, keyC] = keys;
  const [valueA, valueB, valueC] = values;

  async function expectMembersMatch(map: Contract, keys: Array<string | BigNumber>, values: Array<string | BigNumber>) {
    expect(keys.length).to.equal(values.length);

    await Promise.all(keys.map(async (key) => expect(await map.contains(key)).to.equal(true)));

    expect(await map.length()).to.equal(keys.length.toString());

    expect(await Promise.all(keys.map((key) => map.get(key)))).to.have.same.members(values);

    // To compare key-value pairs, we zip keys and values, and convert BNs to
    // strings to workaround Chai limitations when dealing with nested arrays
    expect(
      await Promise.all(
        [...Array(keys.length).keys()].map(async (index) => {
          const entry = await map.at(index);
          return [entry.key.toString(), entry.value];
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
