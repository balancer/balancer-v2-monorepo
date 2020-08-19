import { ethers } from "@nomiclabs/buidler";
import { expect } from "chai";

describe("BPool", function() {
  it("should be deployable", async function() {
    const BPool = await ethers.getContractFactory("BPool");
    const pool = await BPool.deploy();

    await pool.deployed();
    expect(pool.address).to.not.equal(undefined);
  });
});
