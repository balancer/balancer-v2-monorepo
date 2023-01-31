import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { executionAsyncId } from 'async_hooks';
import { SwapKind } from '@balancer-labs/balancer-js/src/types';


describe('SiloLinearPool', function () {
    let poolFactory: Contract;
    let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;
    let vault: Vault;
    let pool: LinearPool;
    let mockSilo: Contract;
    let mainToken: Token, wrappedToken: Token, tokens: TokenList;

    before('setup', async () => {
        [, lp, trader, owner] = await ethers.getSigners();
    });

    sharedBeforeEach('deploy factory', async () => {
        vault = await Vault.create();
        const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });

        poolFactory = await deploy('SiloLinearPoolFactory', {
            args: [vault.address, vault.getFeesProvider().address, queries.address, '1.0', '1.0'],
        });
    });
    
    async function deployPool(mainTokenAddress: string, wrappedTokenAddress: string) {
        const tx = await poolFactory.create(
            'Linear pool',
            'BPT',
            mainTokenAddress,
            wrappedTokenAddress,
            bn(0),
            fp(0.01),
            owner.address
        );

        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'PoolCreated');

        return LinearPool.deployedAt(event.args.pool);
    }

    sharedBeforeEach('deploy pool & tokens', async () => {
        mainToken = await Token.create({symbol: 'USDC', decimals: 6});
        
        mockSilo = await deploy('MockSilo', {
            args: [mainToken.address],
          });
        
        
        const wrappedTokenInstance = await deploy('MockShareToken', {
        args: ['sUSDC', 'sUSDC', mockSilo.address, mainToken.address, mainToken.decimals],
        });
        
        await wrappedTokenInstance.setTotalSupply(1000000);

        wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

        tokens = new TokenList([mainToken, wrappedToken]).sort();

        await tokens.mint({ to: [lp, trader], amount: fp(100) });
        
        pool = await deployPool(mainToken.address, wrappedToken.address);
    });

    describe('constructor', () => {
        it('reverts if the mainToken is not the ASSET of the wrappedToken', async () => {
            const otherToken = await Token.create('DAI');

            await expect(
                poolFactory.create(
                'Balancer Pool Token',
                'BPT',
                otherToken.address,
                wrappedToken.address,
                bn(0),
                fp(0.01),
                owner.address
                )
            ).to.be.revertedWith('TOKENS_MISMATCH');
        })
    })

    describe('asset managers', () => {

        it('sets the same asset manager for main and wrapped token', async () => {
            const poolId = await pool.getPoolId();

            const { assetManager: firsAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);
            const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second);
            
            expect(firsAssetManager).to.be.equal(secondAssetManager);
        });

        it('sets the no asset manager for the BPT', async () => {
            const poolId = await pool.getPoolId();
            const { assetManager } = await vault.instance.getPoolTokenInfo(poolId, pool.address);
            expect(assetManager).to.equal(ZERO_ADDRESS);
        });
    });

    // Add testing for exchange rates
    describe('get wrapped token rate', () => {
        
        it("verify that the exchange rate function works", async () => {
            // initalize the asset storage mapping within the Silo for the main token
            await mockSilo.setAssetStorage(
                mainToken.address,
                wrappedToken.instance.address,
                wrappedToken.instance.address,
                wrappedToken.instance.address,
                20000,
                100,
                9000
            );

            // Calculate the expected rate and compare to the getWrappedToken return value
            const assetStorage = await mockSilo.assetStorage(mainToken.address);
            // Get the 4th member from the struct 'total deposits'
            const totalAmount = assetStorage[3];

            const totalShares: number = await wrappedToken.instance.totalSupply();

            const expectedRate: number = (1 * totalAmount) / totalShares;

            expect(await pool.getWrappedTokenRate()).to.equal(fp(expectedRate));
        }) 
    });
})