const { expect } = require('chai');

const authorizer = "0xcacac0c929de862EE2251d92eac1106633D7a261";
const wethAddress = "0xc778417E063141139Fce010982780140Aa0cD5Ab";
const bufferPeriodDuration = 0;
const pauseWindowDuration = 0;

let initial_mint = 100e6;
const initialBalances = [50e6, 50e6];
let swapFeePercentage = 3000000000000000;



describe('TEST', () => {
	let owner, addr1, addr2, addr3, addr4, addr5;
	let wbtc, weth;
	let vault;
	let weightedPoolFactory;
	let poolId;

	describe('1) Deploy contracts', () => {
		let Wbtc, Weth;

		describe('Get Local Addresses', () => {
				it('Should Get Local addresses', async () => {
					[owner, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
				});
		});

		describe('ERC-20 contracts', () => {
				describe('Deploying WETH Contract Token', () => {
					it('Should deploy the WETH Contract', async () => {
						Weth = await ethers.getContractFactory('Weth');
						weth = await Weth.deploy();
						console.log (`\t\tWETH Address: ${weth.address}`);
					});
				});
				describe('Deploying WBTC Contract Token', () => {
					it('Should deploy the WBTC Contract', async () => {
						Wbtc = await ethers.getContractFactory('Wbtc');
						wbtc = await Wbtc.deploy();
						console.log (`\t\tWBTC Address: ${wbtc.address}`);
					});
				});
				describe('Checks', () => {
					it('Should totalSupply be 0 in both contracts', async () => {
						expect(await weth.totalSupply()).to.equal(0);
					});
				});
		});

		describe('Vault contract', () => {
			let Vault;

			describe('Deploying Contract', () => {
				it('Should deploy the Vault Contract', async () => {
					Vault = await ethers.getContractFactory('Vault');
					vault = await Vault.deploy(
						authorizer,             // authorizer {Address}
						wethAddress,            // weth address {Address}
						bufferPeriodDuration,   // pauseWindowDuration {uint256}
						pauseWindowDuration     // bufferPeriodDuration {uint256}
						);
					console.log (`\t\tVault Address: ${vault.address}`);
					//console.log (vault);
				});
			});

			describe('Checks', () => {
				it('Check the right authorizer address', async () => {
				    expect(await vault.getAuthorizer()).to.equal(authorizer);
				});

				it('Check the right WETH address', async () => {
				    expect(await vault.WETH()).to.equal(wethAddress);
				});


			});
		});
		
		describe('WeightedPoolFactory contract', () => {
			let WeightedPoolFactory;

			describe('Deploying Contract', () => {
				it('Should deploy the WeightedPoolFactory Contract', async () => {
					WeightedPoolFactory = await ethers.getContractFactory('WeightedPoolFactory');
					weightedPoolFactory = await WeightedPoolFactory.deploy(vault.address);
					console.log (`\t\tWeightedPoolFactory Address: ${weightedPoolFactory.address}`);
					//console.log (weightedPoolFactory);
				});
			});
		});
	
	});
	
	describe('2) Initial Settings', () => {
	
		describe('Mint and approve ERC-20s', () => {
				it('Mint WBTC 100 Token (from address1) to address2', async () => {
					await wbtc.mint(addr2.address, initial_mint);
					expect(await wbtc.totalSupply()).to.equal(initial_mint);
				});
				it('Mint WETH 100 Token (from address1) to address2', async () => {
					await weth.mint(addr2.address, initial_mint);
					expect(await weth.totalSupply()).to.equal(initial_mint);
				});
				it('Approbe WETH for Vault Contract in address2', async () => {
					await weth.connect(addr2).approve(vault.address, initial_mint);
					expect(await weth.allowance(addr2.address,vault.address)).to.equal(initial_mint);
				});
				it('Approbe WBTC for Vault Contract in address2', async () => {
					await wbtc.connect(addr2).approve(vault.address, initial_mint);
					expect(await wbtc.allowance(addr2.address,vault.address)).to.equal(initial_mint);
				});
		});
			
	});
	
	describe('3) Create pool and funded (address2)', () => {
		//const erc20_address = ;
		const weight_pool = [BigInt(400000000000000000), BigInt(600000000000000000)];
		const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'; 

		// it('Get creation Code Before', async () => {
		// 	let a = await weightedPoolFactory.getCreationCode();
		// 	console.log(a);
		// });

		it('Address2 invoke CREATE function in WeightedPoolFactory', async () => {
			let tx = await weightedPoolFactory.create(
				"prueba",
				"prue",
				[weth.address, wbtc.address],
				weight_pool,
				[addr3.address, addr4.address],
				swapFeePercentage,
				ZERO_ADDRESS,
				);

				const receipt = await tx.wait();

				// We need to get the new pool address out of the PoolCreated event
			const events = receipt.events.filter((e) => e.event === 'PoolCreated');
			const poolAddress = events[0].args.pool;
			console.log(`\t\tNew Pool Address: ${poolAddress}`);

			const pool = await ethers.getContractAt('WeightedPool', poolAddress);
			poolId  = await pool.getPoolId();
			console.log(`\t\tNew Pool ID: ${poolId}`);

			//console.log (`\t\tVerification: ${ver}`);
			// for(var property in ver) {
			// 	console.log("key: " + property + "|| value: " + ver[property]);
			// }

			//let b = await vault.getPoolTokens(pool_id);

			
		});

		describe('Address2 Fund the new pool', () => {

			it('Address2 Fund the new pool', async () => {
				// Tokens must be in the same order
				// Values must be decimal-normalized! (USDT has 6 decimals)

				// Construct userData
				const JOIN_KIND_INIT = 0;
				const initUserData =
					ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256[]'],
						[JOIN_KIND_INIT, initialBalances]);

				// Pool Request		
				const joinPoolRequest = {
					assets: [weth.address, wbtc.address],
					maxAmountsIn: initialBalances,
					userData: initUserData,
					fromInternalBalance: false
				}

				// define caller as the address you're calling from
				//caller = addr2.address;

				// joins are done on the Vault
				const tx = await vault.connect(addr2).joinPool(
														poolId, 
														addr2.address, 
														addr2.address, 
														joinPoolRequest
														);

				// You can wait for it like this, or just print the tx hash and monitor
				//const receipt = await tx.wait();

			});

		});
	});


});
