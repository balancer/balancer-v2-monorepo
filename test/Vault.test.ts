import { ethers } from "@nomiclabs/buidler";
import { expect } from "chai";
import { ContractFactory, Contract, Signer } from "ethers";

describe("Vault", () => {
  let VaultFactory: ContractFactory;
  let vault: Contract;

  before(async () => {
    VaultFactory = await ethers.getContractFactory("Vault");
  });

  beforeEach('deploy vault from feeCollector', async () => {
    vault = await (await VaultFactory.deploy()).deployed();
  });
});
