// SPDX-License-Identifier: GPL-3.0-or-later

import "./TestBPTToken.sol";
import "../interfaces.sol";

pragma solidity 0.7.1;

contract PropertiesBPTToken is TestBPTToken, CryticInterface {
    constructor() TestBPTToken("BPT", "BPT") { } 

    function echidna_zero_always_empty_ERc20Properties() public view returns (bool) {
        return this.balanceOf(address(0x0)) == 0;
    } 
    function echidna_approve_overwrites() public returns(bool){
		bool approve_return; 
		approve_return = approve(crytic_user, 10);
		require(approve_return);
		approve_return = approve(crytic_user, 20);
		require(approve_return);
		return this.allowance(msg.sender, crytic_user) == 20;
	}
	function echidna_less_than_total_ERC20Properties() public view returns(bool){
		return this.balanceOf(msg.sender) <= this.totalSupply();
	}
  
	function echidna_totalSupply_consistant_ERC20Properties() public view returns(bool){
		return this.balanceOf(crytic_owner) + this.balanceOf(crytic_user) + this.balanceOf(crytic_attacker) <= this.totalSupply();
	}

	function echidna_revert_transfer_to_zero_ERC20PropertiesTransferable() public returns(bool){
		if (this.balanceOf(msg.sender) == 0){
			revert();
		}
		return transfer(address(0x0), this.balanceOf(msg.sender));
	}

	function echidna_revert_transferFrom_to_zero_ERC20PropertiesTransferable() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		if (balance == 0){
			revert();
		}
		approve(msg.sender, balance);
		return transferFrom(msg.sender, address(0x0), this.balanceOf(msg.sender));
	}

	function echidna_self_transferFrom_ERC20PropertiesTransferable() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		bool approve_return = approve(msg.sender, balance);
		bool transfer_return = transferFrom(msg.sender, msg.sender, balance);
		return (this.balanceOf(msg.sender) == balance) && approve_return && transfer_return;
	}

	function echidna_self_transferFrom_to_other_ERC20PropertiesTransferable() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		bool approve_return = approve(msg.sender, balance);
		address other = crytic_user;
		if (other == msg.sender) {
			other = crytic_owner;
		}
		bool transfer_return = transferFrom(msg.sender, other, balance);
		return (this.balanceOf(msg.sender) == 0) && approve_return && transfer_return;
	}

	function echidna_self_transfer_ERC20PropertiesTransferable() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		bool transfer_return = transfer(msg.sender, balance);
		return (this.balanceOf(msg.sender) == balance) && transfer_return;
	}

	function echidna_transfer_to_other_ERC20PropertiesTransferable() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		address other = crytic_user;
		if (other == msg.sender) {
			other = crytic_owner;
		}
		if (balance >= 1) {
			bool transfer_other = transfer(other, 1);
			return (this.balanceOf(msg.sender) == balance-1) && (this.balanceOf(other) >= 1) && transfer_other;
		}
		return true;
	}

	function echidna_revert_transfer_to_user_ERC20PropertiesTransferable() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		if (balance == (2 ** 256 - 1))
			return true;
		bool transfer_other = transfer(crytic_user, balance+1);
		return transfer_other;
	}
}
