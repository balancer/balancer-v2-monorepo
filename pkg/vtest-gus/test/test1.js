const { expect } = require('chai');

const authorizer = "0xcacac0c929de862EE2251d92eac1106633D7a261";
const wethAddress = "0xc778417E063141139Fce010982780140Aa0cD5Ab";
const bufferPeriodDuration = 0;
const pauseWindowDuration = 0;

let initial_mint = 10e12;	// For Funds Pools
let initial_mint2 = 20e5;	// For Swap1 in address2
let initial_mint3 = 100e5;	// For Swap2 in address3
const initialBalances = [initial_mint/2, initial_mint/2];
let swapFeePercentage = BigInt(0.5 * 1e16);  // fee% * 1e16 -- min/max values (0.0001% and 10% respectively)
const weight_pool = [BigInt(50e16), BigInt(50e16)];
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'; 



describe('TEST', () => {
	let owner, addr1, addr2, addr3, addr4, addr5;
	let wbtc, weth;
	let vault;
	let weightedPoolFactory, stablePoolFactory;
	let wPoolAddress, wPoolId, sPoolAddress, sPoolId;

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

		describe('StablePoolFactory contract', () => {
			let StablePoolFactory;

			describe('Deploying Contract', () => {
				it('Should deploy the StablePoolFactory Contract', async () => {
					StablePoolFactory = await ethers.getContractFactory('StablePoolFactory');
					stablePoolFactory = await StablePoolFactory.deploy(vault.address);
					console.log (`\t\StablePoolFactory Address: ${weightedPoolFactory.address}`);
					//console.log (weightedPoolFactory);
				});
			});
		});
	
	});
	
	describe('2) Initial Settings', () => {
	
		describe('Mint and approve ERC-20s for Address 1', () => {
				it('Mint WBTC 1000 Token (from owner) to address1', async () => {
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
				it('Approbe WBTC for Vault Contract in address2', async () => {
					await wbtc.connect(addr1).approve(vault.address, initial_mint);
					expect(await wbtc.allowance(addr1.address,vault.address)).to.equal(initial_mint);
				});
		});

		describe('Mint and approve ERC-20s (just WETH) for Address 3', () => {
			it('Mint WETH 10 Token (from owner) to address1', async () => {
				await weth.mint(addr2.address, initial_mint2);
				//expect(await weth.totalSupply()).to.equal(initial_mint2);
			});
			it('Approbe WETH for Vault Contract in address1', async () => {
				await weth.connect(addr2).approve(vault.address, initial_mint2);
				expect(await weth.allowance(addr2.address,vault.address)).to.equal(initial_mint2);
			});
		});

		describe('Mint and approve ERC-20s (just WBTC) for Address 3', () => {
			it('Mint WBTC 200 Token (from owner) to address3', async () => {
				await wbtc.mint(addr3.address, initial_mint3);
				//expect(await weth.totalSupply()).to.equal(initial_mint2);
			});
			it('Approbe WBTC for Vault Contract in address3', async () => {
				await wbtc.connect(addr3).approve(vault.address, initial_mint3);
				expect(await wbtc.allowance(addr3.address,vault.address)).to.equal(initial_mint3);
			});
		});
	});
	
	describe('3) Create pool and funded (address1)', () => {

		it('Address1 invoke CREATE function in WeightedPoolFactory - Simple pool 50%-50%', async () => {
			let tx = await weightedPoolFactory.create(
				"pruebaWeighted",
				"pruW",
				[weth.address, wbtc.address],
				weight_pool,
				[addr3.address, addr4.address],
				swapFeePercentage,
				ZERO_ADDRESS,
				);
			const receipt = await tx.wait();

				// We need to get the new pool address out of the PoolCreated event
			const events = receipt.events.filter((e) => e.event === 'PoolCreated');
			wPoolAddress = events[0].args.pool;
			console.log(`\t\tNew Weigthed Pool Address / ERC20 LP Token Address: ${wPoolAddress}`);

			const wPool = await ethers.getContractAt('WeightedPool', wPoolAddress);
			wPoolId  = await wPool.getPoolId();
			console.log(`\t\tNew Weigthed Pool ID: ${wPoolId}`);

			console.log(`\t\tNew Weigthed Pool Details: (before funds)`);
			tx = await vault.getPoolTokens(wPoolId);
			console.log(`\t\t\tWeigthed Pool Tokens: ${tx[0]}`);
			console.log(`\t\t\tWeigthed Pool Poolol Balance: ${tx[1]}`);
			console.log(`\t\t\tWeigthed Pool lastChangeBlock: ${tx[2]}`);

			const wLpToken = await ethers.getContractAt('erc20', wPoolAddress);
			let wLpBalance = await wLpToken.totalSupply();
			console.log(`\n\t\t\tERC20 LP Balance: ${wLpBalance}`);

		});

		it('Address1 invoke CREATE function in StablePoolFactory - Simple pool 50%-50%', async () => {
			let tx = await stablePoolFactory.create(
				"pruebaStable",
				"pruS",
				[weth.address, wbtc.address],
				100,
				swapFeePercentage,
				owner.address,
				);
			const receipt = await tx.wait();

				// We need to get the new pool address out of the PoolCreated event
			const events = receipt.events.filter((e) => e.event === 'PoolCreated');
			sPoolAddress = events[0].args.pool;
			console.log(`\t\tNew Stable Pool Address / ERC20 LP Token Address: ${sPoolAddress}`);

			const sPool = await ethers.getContractAt('StablePool', sPoolAddress);
			sPoolId  = await sPool.getPoolId();
			console.log(`\t\tNew Stable Pool ID: ${sPoolId}`);

			console.log(`\t\tNew Stable Pool Details: (before funds)`);
			tx = await vault.getPoolTokens(sPoolId);
			console.log(`\t\t\tStable Pool Tokens: ${tx[0]}`);
			console.log(`\t\t\tStable Pool Pool Balance: ${tx[1]}`);
			console.log(`\t\t\tStable Pool lastChangeBlock: ${tx[2]}`);

			const sLpToken = await ethers.getContractAt('erc20', sPoolAddress);
			let sLpBalance = await sLpToken.totalSupply();
			console.log(`\n\t\t\tERC20 LP Balance: ${sLpBalance}`);

		});


		describe('Address1 Fund the new pool -> with 500 weth and 500 wbtc ', () => {

			it('Address1 Fund the new Weighted pool', async () => {
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
					wPoolId,
					addr1.address,
					addr1.address,
					joinPoolRequest
				);

				// You can wait for it like this, or just print the tx hash and monitor
				//const receipt = await tx.wait();

				console.log(`\t\tNew Weighted Pool Details: (after funds)`);
				tx = await vault.getPoolTokens(wPoolId);
				console.log(`\t\t\tWeighted Pool Tokens: ${tx[0]}`);
				console.log(`\t\t\tWeighted Pool Balance: ${tx[1]}`);
				console.log(`\t\t\tWeighted Pool lastChangeBlock: ${tx[2]}`);

				const wLpToken = await ethers.getContractAt('erc20', wPoolAddress);
				let wLpBalance = await wLpToken.totalSupply();
				console.log(`\n\t\t\tERC20 LP Balance: ${wLpBalance}`);
			});


			it('Address1 Fund the new Stable pool', async () => {

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
					sPoolId,
					addr1.address,
					addr1.address,
					joinPoolRequest
				);

				// You can wait for it like this, or just print the tx hash and monitor
				//const receipt = await tx.wait();

				console.log(`\t\tNew Stable Pool Details: (after funds)`);
				tx = await vault.getPoolTokens(sPoolId);
				console.log(`\t\t\tStable Pool Tokens: ${tx[0]}`);
				console.log(`\t\t\tStable Pool Balance: ${tx[1]}`);
				console.log(`\t\t\tStable Pool lastChangeBlock: ${tx[2]}`);

				const sLpToken = await ethers.getContractAt('erc20', sPoolAddress);
				let sLpBalance = await sLpToken.totalSupply();
				console.log(`\n\t\t\tERC20 LP Balance: ${sLpBalance}`);
			});


		});
	});

	describe('4) First Swap - Address2', () => {

		it('Swap Simple Attempt in Weighted Pool->  10 WETH - X??X WBTC', async () => {

			const swap_amount = initial_mint2/2;
			const deadline = 11579208923731617853269984665640564039457584007913129639935;
			const valuesBefore = await vault.getPoolTokens(wPoolId);

			// BatchSwapStep	
			const singleSwaps = {
				poolId: wPoolId,
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


			console.log(`\t\tNew Weigthed Pool Details: (before funds)`);
			tx = await vault.getPoolTokens(wPoolId);
			console.log(`\t\t\tWeigthed Pool Tokens: ${tx[0]}`);
			console.log(`\t\t\tWeigthed Pool Poolol Balance: ${tx[1]}`);
			console.log(`\t\t\tWeigthed Pool lastChangeBlock: ${tx[2]}`);

			console.log(`\t\t\tSwap Final Values: [WETH: ${valuesBefore[1][0] - tx[1][0]},  WBTC: ${valuesBefore[1][1] - tx[1][1]}]`);
		});

		it('Swap Simple Attempt in Stable Pool->  10 WETH - X??X WBTC', async () => {

			const swap_amount = initial_mint2/2;
			const deadline = 11579208923731617853269984665640564039457584007913129639935;
			const valuesBefore = await vault.getPoolTokens(sPoolId);

			// BatchSwapStep	
			const singleSwaps = {
				poolId: sPoolId,
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


			console.log(`\t\tNew Stable Pool Details: (before funds)`);
			tx = await vault.getPoolTokens(sPoolId);
			console.log(`\t\t\tStable Pool Tokens: ${tx[0]}`);
			console.log(`\t\t\tStable Pool Poolol Balance: ${tx[1]}`);
			console.log(`\t\t\tStable Pool lastChangeBlock: ${tx[2]}`);

			console.log(`\t\t\tSwap Final Values: [WETH: ${valuesBefore[1][0] - tx[1][0]},  WBTC: ${valuesBefore[1][1] - tx[1][1]}]`);

		});

		it('Final Balance Logs in Address 2', async () => {
			let wbtcBalance = await wbtc.balanceOf(addr2.address);
			console.log(`\t\t\tInitial Balance WETH in Addr2: ${initial_mint2}`);
			console.log(`\t\t\tActual Balance WBTC in Addr2: ${wbtcBalance}`);
		});



	describe('5) Second Swap - Address3', () => {

		it('Swap Simple Attempt in Weighted Pool->  100 WBTC - X??X WWETH', async () => {

			const swap_amount = initial_mint3/2;
			const deadline = 11579208923731617853269984665640564039457584007913129639935;
			const valuesBefore = await vault.getPoolTokens(wPoolId);

			// BatchSwapStep	
			const singleSwaps = {
				poolId: wPoolId,
				kind: 0,
				assetIn: wbtc.address,
				assetOut: weth.address,
				amount: swap_amount,
				userData: '0x'
			};

			// Fund Management	
			const funds = {
				sender: addr3.address,
				fromInternalBalance: false,
				recipient: addr3.address,
				toInternalBalance: false
			};

			let tx = await vault.connect(addr3).swap(
				singleSwaps,
				funds,
				[0, 0],
				BigInt(deadline)
			);


			console.log(`\t\tNew Weigthed Pool Details: (before funds)`);
			tx = await vault.getPoolTokens(wPoolId);
			console.log(`\t\t\tWeigthed Pool Tokens: ${tx[0]}`);
			console.log(`\t\t\tWeigthed Pool Pool Balance: ${tx[1]}`);
			console.log(`\t\t\tWeigthed Pool lastChangeBlock: ${tx[2]}`);

			console.log(`\t\t\tSwap Final Values: [WETH: ${valuesBefore[1][0] - tx[1][0]},  WBTC: ${valuesBefore[1][1] - tx[1][1]}]`);
		});

		it('Swap Simple Attempt in Stable Pool->  100 WBTC - X??X WETH', async () => {

			const swap_amount = initial_mint3/2;
			const deadline = 11579208923731617853269984665640564039457584007913129639935;
			const valuesBefore = await vault.getPoolTokens(sPoolId);

			// BatchSwapStep	
			const singleSwaps = {
				poolId: sPoolId,
				kind: 0,
				assetIn: wbtc.address,
				assetOut: weth.address,
				amount: swap_amount,
				userData: '0x'
			};

			// Fund Management	
			const funds = {
				sender: addr3.address,
				fromInternalBalance: false,
				recipient: addr3.address,
				toInternalBalance: false
			};

			let tx = await vault.connect(addr3).swap(
				singleSwaps,
				funds,
				[0, 0],
				BigInt(deadline)
			);


			console.log(`\t\tNew Stable Pool Details: (before funds)`);
			tx = await vault.getPoolTokens(sPoolId);
			console.log(`\t\t\tStable Pool Tokens: ${tx[0]}`);
			console.log(`\t\t\tStable Pool Poolol Balance: ${tx[1]}`);
			console.log(`\t\t\tStable Pool lastChangeBlock: ${tx[2]}`);

			console.log(`\t\t\tSwap Final Values: [WETH: ${valuesBefore[1][0] - tx[1][0]},  WBTC: ${valuesBefore[1][1] - tx[1][1]}]`);

		});

		it('Final Balance Logs in Address 3', async () => {
			let wethBalance = await weth.balanceOf(addr3.address);
			console.log(`\t\t\tInitial Balance WBTC in Addr2: ${initial_mint3}`);
			console.log(`\t\t\tActual Balance WETH in Addr2: ${wethBalance}`);
		});

	});

			// it('Batch Swap Attempt', async () => {
			// //it('Swap Attempt -> 2 WETH - XX WBTC', async () => {

			// 	const swap_amount = 3e6;
			// 	const deadline = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

			// 	// BatchSwapStep	
			// 	const swaps = {
			// 		poolId: poolId,
			// 		assetInIndex: 1,
			// 		assetOutIndex: 0,
			// 		amount: swap_amount,
			// it('Batch Swap Attempt', async () => {
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
	});
});


//console.log (`\t\tVerification: ${ver}`);
// for(var property in ver) {
// 	console.log("key: " + property + "|| value: " + ver[property]);
// }