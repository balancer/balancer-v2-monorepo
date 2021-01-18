import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { deploy } from '../../scripts/helpers/deploy';
import { BigNumber, Contract, Wallet } from 'ethers';
import { EIP712Domain, domainSeparator } from './helpers/EIP712';
import { MAX_UINT256 } from '../helpers/constants';

const Permit = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
];

describe('ERC20Permit', function () {
  let initialHolder: SignerWithAddress;
  let spender: SignerWithAddress;
  let recipient: SignerWithAddress;
  let other: SignerWithAddress;
  let token: Contract;
  let chainId: Uint8Array;

  const name = 'My Token';
  const symbol = 'MTKN';
  const version = '1';

  const initialSupply = BigNumber.from((100e18).toString());

  before('deploy base contracts', async () => {
    [, initialHolder, spender, recipient, other] = await ethers.getSigners();
  });

  beforeEach('set up asset manager', async () => {
    token = await deploy('MockBalancerPoolToken', { args: [name, symbol, initialHolder.address, initialSupply] });
 
    // We get the chain id from the contract because Ganache (used for coverage) does not return the same chain id
    // from within the EVM as from the JSON RPC interface.
    // See https://github.com/trufflesuite/ganache-core/issues/515
    chainId = await token.getChainId();
  });

  xit('initial nonce is 0', async function () {
    expect(await token.nonces(initialHolder)).to.equal(0);
  });

  xit('domain separator', async function () {
    expect(
      await token.DOMAIN_SEPARATOR(),
    ).to.equal(
      await domainSeparator(name, version, chainId, token.address),
    );
  });

  describe('permit', function () {
    const wallet = Wallet.createRandom();

    const owner = wallet.address;
    const value = BigNumber.from(42);
    const nonce = 0;
    const maxDeadline = MAX_UINT256;

    const buildData = (chainId: Uint8Array, verifyingContract: string, deadline: BigNumber = maxDeadline) => ({
      primaryType: 'Permit',
      types: { EIP712Domain, Permit },
      domain: { name, version, chainId, verifyingContract },
      message: { owner, spender, value, nonce, deadline },
    });

    xit('accepts owner signature', async function () {
      const data = buildData(chainId, token.address);
      // Doesn't compile
      // const signature = ethSigUtil.signTypedMessage(Buffer.from(wallet.privateKey), { data });
      /*const { v, r, s } = fromRpcSig(signature);

      const receipt = await this.token.permit(owner, spender, value, maxDeadline, v, r, s);

      expect(await this.token.nonces(owner)).to.equal(1);
      expect(await this.token.allowance(owner, spender)).to.equal(value);*/
    });

    xit('rejects reused signature', async function () {
      const data = buildData(this.chainId, this.token.address);
      // Doesn't compile
      //const signature = ethSigUtil.signTypedMessage(Buffer.from(wallet.privateKey), { data });
      /*const { v, r, s } = fromRpcSig(signature);

      await this.token.permit(owner, spender, value, maxDeadline, v, r, s);

      await expect(
        token.permit(owner, spender, value, maxDeadline, v, r, s)
      ).to.be.revertedWith('ERC20Permit: invalid signature');*/
    });

    xit('rejects other signature', async function () {
      const otherWallet = Wallet.createRandom();
      const data = buildData(this.chainId, this.token.address);
      // Doesn't compile
      //const signature = ethSigUtil.signTypedMessage(Buffer.from(otherWallet.privateKey), { data });
      /*const { v, r, s } = fromRpcSig(signature);

      await expect(
        token.permit(owner, spender, value, maxDeadline, v, r, s)
      ).to.be.revertedWith('ERC20Permit: invalid signature');*/
    });

    xit('rejects expired permit', async function () {
      const now = new Date();
      const deadline = BigNumber.from(now.valueOf() - now.setFullYear(now.getFullYear() - 1));

      const data = buildData(chainId, token.address, deadline);
     
      // Doesn't compile
      // const signature = ethSigUtil.signTypedMessage(Buffer.from(wallet.privateKey), { data });
      /*const { v, r, s } = fromRpcSig(signature);

      await expect(
        token.permit(owner, spender, value, deadline, v, r, s)
      ).to.be.revertedWith('ERC20Permit: expired deadline');*/
    });
  });
});
