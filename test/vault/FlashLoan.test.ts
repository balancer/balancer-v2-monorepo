import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { TokenList, deployTokens } from '../helpers/tokens';
import { SignerWithAddress } from 'hardhat-deploy-ethers/dist/src/signer-with-address';

describe('Vault - flashloans', () => {
  let admin: SignerWithAddress;
  let controller: SignerWithAddress;

  let vault: Contract;
  let mockFlashLoanReceiver: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [admin, controller] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    await deployments.fixture();
    vault = await ethers.getContract('Vault');
    mockFlashLoanReceiver = await ethers.getContract('MockFlashLoanReceiver');
    tokens = await deployTokens(admin.address, ['DAI', 'MKR'], [18, 18]);

    const token = tokens.DAI;
    await token.mint(vault.address, (100e18).toString());
    // mint something for paying the fee
    await token.mint(mockFlashLoanReceiver.address, (1e18).toString());
    await vault.connect(admin).setProtocolFlashLoanFee((0.005e18).toString());
  });

  it('Takes out a 50 DAI flashloan, returns the funds correctly', async () => {
    await mockFlashLoanReceiver.setFailExecutionTransfer(false);

    const loanAmount = (50e18).toString();
    await vault.connect(controller).flashLoan(mockFlashLoanReceiver.address, tokens.DAI.address, loanAmount, '0x10');

    const expectedLiquidity = (100.25e18).toString();

    const totalLiquidity = await tokens.DAI.balanceOf(vault.address);

    expect(totalLiquidity.toString()).to.be.equal(expectedLiquidity, 'Invalid final vault balance');
  });

  it('Takes out a flash loan larger than the balance (revert expected)', async () => {
    await mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      vault.flashLoan(mockFlashLoanReceiver.address, tokens.DAI.address, (500e18).toString(), '0x10')
    ).to.be.revertedWith('There is not enough liquidity available to borrow');
  });

  it('Takes out a 500 DAI flashloan, does not return the funds (revert expected)', async () => {
    await mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      vault.flashLoan(mockFlashLoanReceiver.address, tokens.DAI.address, (50e18).toString(), '0x10')
    ).to.be.revertedWith('The actual balance of the protocol is inconsistent');
  });
});
