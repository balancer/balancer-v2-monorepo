// SPDX-License-Identifier: GPL-3.0-or-later
// https://github.com/buttonwood-protocol/button-wrappers/blob/main/contracts/mocks/MockRebasingERC20.sol

pragma solidity ^0.7.0;

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import { IERC20 } from "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import { SafeMath } from "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";

contract MockRebasingERC20 is IERC20 {
    using SafeMath for uint256;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    uint256 private _multiplier;
    uint256 private _multiplierGranularity;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 multiplier_,
        uint256 multiplierGranularity_
    ) {
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        _multiplier = multiplier_;
        _multiplierGranularity = multiplierGranularity_;
    }

    function applyMultiplier(uint256 value) private view returns (uint256) {
        return (value * _multiplier) / _multiplierGranularity;
    }

    function applyInverseMultiplier(uint256 value) private view returns (uint256) {
        return (value * _multiplierGranularity) / _multiplier;
    }

    function totalSupply() public view virtual override returns (uint256) {
        return applyMultiplier(_totalSupply);
    }

    function balanceOf(address account) public view virtual override returns (uint256) {
        return applyMultiplier(_balances[account]);
    }

    function allowance(address owner, address spender)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(msg.sender, recipient, amount, applyInverseMultiplier(amount));
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        _transfer(sender, recipient, amount, applyInverseMultiplier(amount));
        _approve(
            sender,
            msg.sender,
            _allowances[sender][msg.sender].sub(amount, Errors.ERC20_TRANSFER_EXCEEDS_ALLOWANCE)
        );
        return true;
    }

    function rebase(uint256 multiplier_) external {
        _multiplier = multiplier_;
    }

    function mint(address account, uint256 amount) public virtual {
        _mint(account, amount, applyInverseMultiplier(amount));
    }

    function _mint(address account, uint256 amount, uint256 scaledAmount) internal virtual {
        _totalSupply = _totalSupply.add(scaledAmount);
        _balances[account] = _balances[account].add(scaledAmount);
        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount, uint256 scaledAmount) internal virtual {
        _require(account != address(0), Errors.ERC20_BURN_FROM_ZERO_ADDRESS);
        _balances[account] = _balances[account].sub(scaledAmount, Errors.ERC20_BURN_EXCEEDS_ALLOWANCE);
        _totalSupply = _totalSupply.sub(scaledAmount);
        emit Transfer(account, address(0), amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 scaledAmount
    ) internal virtual {
        _require(sender != address(0), Errors.ERC20_TRANSFER_FROM_ZERO_ADDRESS);
        _require(recipient != address(0), Errors.ERC20_TRANSFER_TO_ZERO_ADDRESS);

        _balances[sender] = _balances[sender].sub(scaledAmount, Errors.ERC20_TRANSFER_EXCEEDS_BALANCE);
        _balances[recipient] = _balances[recipient].add(scaledAmount);
        
        emit Transfer(sender, recipient, amount);
    }
}
