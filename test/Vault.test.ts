import { ethers } from "@nomiclabs/buidler";
import { expect } from "chai";
import { ContractFactory, Contract, Signer } from "ethers";

describe("Vault", () => {
  let VaultFactory: ContractFactory;
  let vault: Contract;

  let feeCollector: Signer;

  before(async () => {
    VaultFactory = await ethers.getContractFactory("Vault");

    [feeCollector] = await ethers.getSigners();
  });

  beforeEach('deploy vault from feeCollector', async () => {
    vault = await (await VaultFactory.connect(feeCollector).deploy()).deployed();
  });

  it("has correct feeCollector", async function() {
    expect(await vault.getFeeCollector()).to.equal(await feeCollector.getAddress());
  });
});
