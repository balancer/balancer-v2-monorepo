const { expect } = require('chai');

const authorizer = "0xcacac0c929de862EE2251d92eac1106633D7a261";
const wethAddress = "0xc778417E063141139Fce010982780140Aa0cD5Ab";
const bufferPeriodDuration = 0;
const pauseWindowDuration = 0;

let initial_mint = 1000e6;
let initial_mint2 = 20e6;
const initialBalances = [500e6, 500e6];
let swapFeePercentage = 3000000000000000;
const weight_pool = [BigInt(50e16), BigInt(50e16)];
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'; 



describe('TEST', () => {
	let owner, addr1, addr2, addr3, addr4, addr5;
	let wbtc, weth;
	let vault;
	let weightedPoolFactory;
	let poolAddress, poolId;

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
	
		describe('Mint and approve ERC-20s for Address 1', () => {
				it('Mint WBTC 500 Token (from owner) to address1', async () => {
					await wbtc.mint(addr1.address, initial_mint);
					expect(await wbtc.totalSupply()).to.equal(initial_mint);
				});
				it('Mint WETH 500 Token (from owner) to address1', async () => {
					await weth.mint(addr1.address, initial_mint);
					expect(await weth.totalSupply()).to.equal(initial_mint);
				});
				it('Approbe WETH for Vault Contract in address1', async () => {
					await weth.connect(addr1).approve(vault.address, initial_mint);
					expect(await weth.allowance(addr1.address,vault.address)).to.equal(initial_mint);
				});
				it('Approbe WBTC for Vault Contract in address1', async () => {
					await wbtc.connect(addr1).approve(vault.address, initial_mint);
					expect(await wbtc.allowance(addr1.address,vault.address)).to.equal(initial_mint);
				});
		});
		
		describe('Mint and approve ERC-20s (just WETH) for Address 2', () => {
			it('Mint WETH 10 Token (from owner) to address1', async () => {
				await weth.mint(addr2.address, initial_mint2);
				//expect(await weth.totalSupply()).to.equal(initial_mint2);
			});
			it('Approbe WETH for Vault Contract in address1', async () => {
				await weth.connect(addr2).approve(vault.address, initial_mint2);
				expect(await weth.allowance(addr2.address,vault.address)).to.equal(initial_mint2);
			});
		});
	});
	
	describe('3) Create pool and funded (address1)', () => {
		//const erc20_address = ;


		// it('Get creation Code Before', async () => {
		// 	let a = await weightedPoolFactory.getCreationCode();
		// 	console.log(a);
		// });

		it('Address1 invoke CREATE function in WeightedPoolFactory - Simple pool 50%-50%', async () => {
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
			poolAddress = events[0].args.pool;
			console.log(`\t\tNew Pool Address / ERC20 LP Token Address: ${poolAddress}`);

			const pool = await ethers.getContractAt('WeightedPool', poolAddress);
			poolId  = await pool.getPoolId();
			console.log(`\t\tNew Pool ID: ${poolId}`);



			console.log(`\t\tNew Pool Details: (before funds)`);
			tx = await vault.getPoolTokens(poolId);
			console.log(`\t\t\tPool Tokens: ${tx[0]}`);
			console.log(`\t\t\tPool Balance: ${tx[1]}`);
			console.log(`\t\t\tPool lastChangeBlock: ${tx[2]}`);
			//receipt = await tx.wait();

			//console.log(`\t\t\tPool Tokens: ${tx.events[0].args.tokens}`);


			//console.log (`\t\tVerification: ${ver}`);
			// for(var property in ver) {
			// 	console.log("key: " + property + "|| value: " + ver[property]);
			// }

			//let b = await vault.getPoolTokens(pool_id);


			const lpToken = await ethers.getContractAt('erc20', poolAddress);
			let lpBalance = await lpToken.totalSupply();
			console.log(`\n\t\t\tERC20 LP Balance: ${lpBalance}`);

		});

		describe('Address1 Fund the new pool -> with 500 weth and 500 wbtc ', () => {

			it('Address1 Fund the new pool', async () => {
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
				//caller = addr1.address;

				// joins are done on the Vault
				let tx = await vault.connect(addr1).joinPool(
														poolId, 
														addr1.address, 
														addr1.address, 
														joinPoolRequest
														);

				// You can wait for it like this, or just print the tx hash and monitor
				//const receipt = await tx.wait();

				console.log(`\t\tNew Pool Details: (after funds)`);
				tx = await vault.getPoolTokens(poolId);
				console.log(`\t\t\tPool Tokens: ${tx[0]}`);
				console.log(`\t\t\tPool Balance: ${tx[1]}`);
				console.log(`\t\t\tPool lastChangeBlock: ${tx[2]}`);


				const lpToken = await ethers.getContractAt('erc20', poolAddress);
				let lpBalance = await lpToken.totalSupply();
				console.log(`\n\t\t\tERC20 LP Balance: ${lpBalance}`);

			});

		});
	});

	describe('4) Swap - Address2', () => {

		// it('Swap Attempt', async () => {

		// //it('Swap Attempt -> 2 WETH - XX WBTC', async () => {

		// 	const swap_amount = 3e6;
		// 	const deadline = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

		// 	// BatchSwapStep	
		// 	const swaps = {
		// 		poolId: poolId,
		// 		assetInIndex: 1,
		// 		assetOutIndex: 0,
		// 		amount: swap_amount,
		// 		userData: '0x'
		// 	};

		// 	const assets = [wbtc.address, weth.address];

		// 	// Fund Management	
		// 	const funds = {
		// 		sender: addr2.address,
		// 		fromInternalBalance: false,
		// 		recipient: addr2.address,
		// 		toInternalBalance: false
		// 	};
			
		// 	// let tx = await vault.connect(addr2).batchSwap(
		// 	// 										0, 
		// 	// 										swaps, 
		// 	// 										assets, 
		// 	// 										funds,
		// 	// 										swap_amount,
		// 	// 										BigInt(deadline)
		// 	// 										);

			
		// 	// console.log(`\t\tNew Pool Details: (after funds)`);
		// 	// tx = await vault.getPoolTokens(poolId);
		// 	// console.log(`\t\t\tPool Tokens: ${tx[0]}`);
		// 	// console.log(`\t\t\tPool Balance: ${tx[1]}`);
		// 	// console.log(`\t\t\tPool lastChangeBlock: ${tx[2]}`);



		// });

		it('Swap Simple Attempt ->  10 WETH - X??X WBTC', async () => {

			//it('Swap Attempt -> 2 WETH - XX WBTC', async () => {
	
				const swap_amount = 10e6;
				const deadline = 11579208923731617853269984665640564039457584007913129639935;
	
				// BatchSwapStep	
				const singleSwaps = {
					poolId: poolId,
					kind: 0,
					assetIn: weth.address,
					assetOut: wbtc.address,
					amount: swap_amount,
					userData: '0x'
				};
	
				// Fund Management	
				const funds = {
					sender: addr2.address,
					fromInternalBalance: false,
					recipient: addr2.address,
					toInternalBalance: false
				};
				
				let tx = await vault.connect(addr2).swap( 
														singleSwaps,
														funds,
														[0, 0],
														BigInt(deadline)
														);
	
				
				console.log(`\t\tNew Pool Details: (after funds)`);
				tx = await vault.getPoolTokens(poolId);
				console.log(`\t\t\tPool Tokens: ${tx[0]}`);
				console.log(`\t\t\tPool Balance: ${tx[1]}`);
				console.log(`\t\t\tPool lastChangeBlock: ${tx[2]}`);

				const lpToken = await ethers.getContractAt('erc20', poolAddress);
				let lpBalance = await lpToken.totalSupply();
				console.log(`\n\t\t\tERC20 LP Balance: ${lpBalance}`);
	
	
	
			});
	});
		


});
