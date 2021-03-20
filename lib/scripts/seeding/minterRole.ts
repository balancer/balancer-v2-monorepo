import { ethers } from 'hardhat';
import { Dictionary } from 'lodash';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deepEqual } from 'assert';

import * as allPools from './allPools.json';
import { bn, fp } from '../../helpers/numbers';
import { TokenList, deployTokens } from '../../helpers/tokens';
import { WEEK } from '../../helpers/time';
import { encodeJoinWeightedPool } from '../../helpers/weightedPoolEncoding';
import { MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { formatPools, getTokenInfoForDeploy, Pool } from './processJSON';

let deployer: SignerWithAddress;
let controller: SignerWithAddress;
let trader: SignerWithAddress;
//let validator: Contract;
let assetManager: SignerWithAddress; // This would normally be a contract

const NUM_POOLS = 10;

const decimalsByAddress: Dictionary<number> = {};

async function main() {
  [deployer, controller] = await ethers.getSigners();

  console.log(deployer.address)

  const FAUCET = '0x4f6D439924E2744bf624B388FeF0f3B790c1762B';

  const tokens = [
    '0xaCec30eb6aE25c582A5A860E6265F1a024De6afC',
    // '0x8C2dC411b75115E0B358595C9b8B09b91258bf01',
    // '0xa92e018F54337690b1b190B27a959c384d004f7b',
    // '0x9dd9829d7a781F4f1e04D2227c472c589fe1D78D',
    // '0xD320647E67d7e3d350ecf20913141fe0227b7b7d',
    // '0xC27A406EF60955F9446B27B0c3c21cDBde57eacC',
    // '0x29C3Abb16B2b6201f25e32a4BA5B7b14118be1E6'
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

