import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../scripts/helpers/deploy';
import { zip } from 'lodash';

let accountA: string;
let accountB: string;
let accountC: string;

let map: Contract;

describe('EnumerableMap', () => {
  const keyA = BigNumber.from('7891');
  const keyB = BigNumber.from('451');
  const keyC = BigNumber.from('9592328');

  before(async () => {
    [, accountA, accountB, accountC] = (await ethers.getSigners()).map((signer) => signer.address);
  });

  beforeEach(async () => {
    map = await deploy('EnumerableMapMock', { args: [] });
  });

  async function expectMembersMatch(map: Contract, keys: Array<BigNumber>, values: Array<string>) {
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
    expect(await map.contains(keyA)).to.equal(false);

    await expectMembersMatch(map, [], []);
  });

  describe('set', () => {
    it('adds a key', async () => {
      const receipt = await (await map.set(keyA, accountA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

      await expectMembersMatch(map, [keyA], [accountA]);
    });

    it('adds several keys', async () => {
      await map.set(keyA, accountA);
      await map.set(keyB, accountB);

      await expectMembersMatch(map, [keyA, keyB], [accountA, accountB]);
      expect(await map.contains(keyC)).to.equal(false);
    });

    it('returns false when adding keys already in the set', async () => {
      await map.set(keyA, accountA);

      const receipt = await (await map.set(keyA, accountA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: false });

      await expectMembersMatch(map, [keyA], [accountA]);
    });

    it('updates values for keys already in the set', async () => {
      await map.set(keyA, accountA);

      await map.set(keyA, accountB);

      await expectMembersMatch(map, [keyA], [accountB]);
    });
  });

  describe('remove', () => {
    it('removes added keys', async () => {
      await map.set(keyA, accountA);

      const receipt = await (await map.remove(keyA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: true });

      expect(await map.contains(keyA)).to.equal(false);
      await expectMembersMatch(map, [], []);
    });

    it('returns false when removing keys not in the set', async () => {
      const receipt = await (await map.remove(keyA)).wait();
      expectEvent.inReceipt(receipt, 'OperationResult', { result: false });

      expect(await map.contains(keyA)).to.equal(false);
    });

    it('adds and removes multiple keys', async () => {
      // []

      await map.set(keyA, accountA);
      await map.set(keyC, accountC);

      // [A, C]

      await map.remove(keyA);
      await map.remove(keyB);

      // [C]

      await map.set(keyB, accountB);

      // [C, B]

      await map.set(keyA, accountA);
      await map.remove(keyC);

      // [A, B]

      await map.set(keyA, accountA);
      await map.set(keyB, accountB);

      // [A, B]

      await map.set(keyC, accountC);
      await map.remove(keyA);

      // [B, C]

      await map.set(keyA, accountA);
      await map.remove(keyB);

      // [A, C]

      await expectMembersMatch(map, [keyA, keyC], [accountA, accountC]);

      expect(await map.contains(keyB)).to.equal(false);
    });
  });
});
