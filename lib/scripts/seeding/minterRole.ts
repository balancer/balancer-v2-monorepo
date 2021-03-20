import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';


let deployer: SignerWithAddress;

async function main() {
  [deployer] = await ethers.getSigners();

  const FAUCET = '0x4f6D439924E2744bf624B388FeF0f3B790c1762B';

  const tokens = [
    '0xe1329748c41A140536e41049C95c36A53bCACee6',
    '0x59935f19d720aD935beCdC34c4F367397a28DaED',
    '0xD9D9E09604c0C14B592e6E383582291b026EBced',
    '0xFd05Bbf0e4E2fc552A67F3cb2dD2ecB289252eE1',
    '0x1688C45BC51Faa1B783D274E03Da0A0B28A0A871',
    '0x7A0Fbc1aD60E8d624215282afb0e877E51A08136',
    '0x5468C3a3e32e390C6Fef5E3622a616695b501900'
  ];

  for (const t of tokens) {
    
    const token = await ethers.getContractAt('TestToken', t);
    const minterRole = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('MINTER_ROLE'));

    console.log(`Adding mint role for ${token.address}`);
    await token.connect(deployer).grantRole(minterRole, FAUCET);

  }

  return;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

