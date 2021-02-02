import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractFunction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { deployPoolFromFactory, SimplifiedQuotePool, StandardPool, TwoTokenPool } from '../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { FIXED_POINT_SCALING, toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { constant } from 'lodash';

describe('ConstantProductPool', function () {
  let admin: SignerWithAddress;
  let creator: SignerWithAddress;
  let lp: SignerWithAddress;
  let trader: SignerWithAddress;
  let feeSetter: SignerWithAddress;
  let im1: SignerWithAddress;
  let im2: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList = {};

  let simplifiedPool: Contract;
  let standardPool: Contract;
  let twoTokenPool: Contract;

  const initialBPT = (90e18).toString();

  let poolTokens: string[];
  let poolInitialBalances: BigNumber[];
  let poolWeights: BigNumber[];
  let poolSwapFee: BigNumber;
  const SOLIDITY_VAR="address internal";

  let callDeployPool: () => Promise<Contract>;

  before(async function () {
    [admin, creator, lp, trader, feeSetter, im1, im2] = await ethers.getSigners();
    console.log("admin: ", admin.address);
    console.log("fee setter: ", feeSetter.address)
    console.log("trader: ", trader.address);
  });

  before(async function () {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    //TODO add a pretty printer here
    console.log(SOLIDITY_VAR, 'authorizer =', authorizer.address+";");
    console.log(SOLIDITY_VAR, 'vault =', vault.address+";");
    console.log(SOLIDITY_VAR, 'im1 =', im1.address+";");
    console.log(SOLIDITY_VAR, 'im2 = ', im2.address+";");
    console.log(SOLIDITY_VAR, 'creator = ', creator.address+";")
    console.log(SOLIDITY_VAR, 'lp = ', lp.address+";")

    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    for (const symbol in tokens) {
      await tokens[symbol].mint(creator.address, (100e18).toString());
      await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(lp.address, (200e18).toString());
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(trader.address, (100e18).toString());
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
    }

    console.log("address internal dai = ", tokens.DAI.address+";")
    console.log("address internal mkr = ", tokens.MKR.address+";")

    poolTokens = [tokens.DAI.address, tokens.MKR.address];
    poolInitialBalances = [0.9e18, 1.8e18].map((value) => BigNumber.from(value.toString()));
    poolWeights = [70, 30].map((value) => BigNumber.from(value.toString()));
    poolSwapFee = toFixedPoint(0.01);

    await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
    await vault.connect(feeSetter).setProtocolSwapFee(toFixedPoint(0.01)); // 1%

    simplifiedPool = await deploy('MockPool', {
      args: [vault.address, SimplifiedQuotePool],
    });
    twoTokenPool = await deploy('MockPool', {
      args: [vault.address, SimplifiedQuotePool], //this could be set to TwoTokenPool when an interface exists
    });
    standardPool = await deploy('MockPool', {
      args: [vault.address, SimplifiedQuotePool], //this could be set to StandardPool when an interface exists 
    });
  });

  describe('setup', async () => {
    it('simplifiedpool', async () => {
      let simplifiedPoolId = await simplifiedPool.getPoolId();

      console.log(SOLIDITY_VAR, 'simplifiedPool =', simplifiedPool.address+";");

      await simplifiedPool.setPoolInvestmentManager(simplifiedPoolId, tokens.DAI.address, im1.address);
      await simplifiedPool.setPoolInvestmentManager(simplifiedPoolId, tokens.MKR.address, im2.address);

      expect(await vault.getPoolInvestmentManager(simplifiedPoolId, tokens.DAI.address)).to.equal(im1.address);
      expect(await vault.getPoolInvestmentManager(simplifiedPoolId, tokens.MKR.address)).to.equal(im2.address);

      await vault.connect(lp).addUserAgent(simplifiedPool.address);
      await simplifiedPool.connect(lp).registerTokens([tokens.DAI.address, tokens.MKR.address]);

      await simplifiedPool.connect(lp).addLiquidity(
        [tokens.DAI.address, tokens.MKR.address],
        [(50e18).toString(), (50e18).toString()]
      );
    });
    it('standardpool', async () => {
      let standardPoolId = await standardPool.getPoolId();

      console.log(SOLIDITY_VAR, 'standardPool =', standardPool.address+";");

      await standardPool.setPoolInvestmentManager(standardPoolId, tokens.DAI.address, im1.address);
      await standardPool.setPoolInvestmentManager(standardPoolId, tokens.MKR.address, im2.address);
      
      expect(await vault.getPoolInvestmentManager(standardPoolId, tokens.DAI.address)).to.equal(im1.address);
      expect(await vault.getPoolInvestmentManager(standardPoolId, tokens.MKR.address)).to.equal(im2.address);

      await vault.connect(lp).addUserAgent(standardPool.address);
      await standardPool.connect(lp).registerTokens([tokens.DAI.address, tokens.MKR.address]);
      await standardPool.connect(lp).addLiquidity(
        [tokens.DAI.address, tokens.MKR.address],
        [(50e18).toString(), (50e18).toString()]
      );
    });
    it('twotoken pool', async () => {
      let twoTokenPoolId = await twoTokenPool.getPoolId();

      console.log(SOLIDITY_VAR, 'twoTokenPool =', twoTokenPool.address+";");

      await twoTokenPool.setPoolInvestmentManager(twoTokenPoolId, tokens.DAI.address, im1.address);
      await twoTokenPool.setPoolInvestmentManager(twoTokenPoolId, tokens.MKR.address, im2.address);
      
      expect(await vault.getPoolInvestmentManager(twoTokenPoolId, tokens.DAI.address)).to.equal(im1.address);
      expect(await vault.getPoolInvestmentManager(twoTokenPoolId, tokens.MKR.address)).to.equal(im2.address);

      await vault.connect(lp).addUserAgent(twoTokenPool.address);
      await twoTokenPool.connect(lp).registerTokens([tokens.DAI.address, tokens.MKR.address]);
      await twoTokenPool.connect(lp).addLiquidity(
        [tokens.DAI.address, tokens.MKR.address],
        [(50e18).toString(), (50e18).toString()]
      );
    });
  });
});
