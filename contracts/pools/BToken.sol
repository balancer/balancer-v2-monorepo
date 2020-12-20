// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.1;

// Imports

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// Contracts

/**
 * @title Base class for Balancer Pool Tokens
 * @author Balancer Labs
 * @notice Highly opinionated token implementation
 * @dev - It includes functions to increase and decrease allowance as a workaround
 *        for the well-known issue with 'approve':
 *        https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
 *      - It allows for 'infinite allowance', where an allowance of 0xff..ff is not
 *        decreased by calls to transferFrom
 *      - It lets a token holder use 'transferFrom' to send their own tokens,
 *        without first setting allowance
 *      - It emits 'Approval' events whenever allowance is changed by 'transferFrom'
 */
abstract contract BTokenBase is IERC20 {
    using SafeMath for uint256;

    // State variables

    mapping(address => uint256) internal _balance;
    mapping(address => mapping(address => uint256)) internal _allowance;
    uint256 internal _totalSupply;

    // Function declarations

    // Internal functions

    // Mint an amount of new tokens, and add them to the balance (and total supply)
    // Emit a transfer amount from the null address to this contract
    function _mint(uint256 amount) internal {
        _balance[address(this)] = _balance[address(this)].add(amount);
        _totalSupply = _totalSupply.add(amount);

        emit Transfer(address(0), address(this), amount);
    }

    // Burn an amount of new tokens, and subtract them from the balance (and total supply)
    // Emit a transfer amount from this contract to the null address
    function _burn(uint256 amount) internal {
        _balance[address(this)] = _balance[address(this)].sub(amount, "ERR_INSUFFICIENT_BAL");
        _totalSupply = _totalSupply.sub(amount);

        emit Transfer(address(this), address(0), amount);
    }

    // Transfer tokens from sender to recipient
    // Adjust balances, and emit a Transfer event
    function _move(
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        _balance[sender] = _balance[sender].sub(amount, "ERR_INSUFFICIENT_BAL");
        _balance[recipient] = _balance[recipient].add(amount);

        emit Transfer(sender, recipient, amount);
    }

    // Transfer from this contract to recipient
    // Emits a transfer event if successful
    function _push(address recipient, uint256 amount) internal {
        _move(address(this), recipient, amount);
    }

    // Transfer from recipient to this contract
    // Emits a transfer event if successful
    function _pull(address sender, uint256 amount) internal {
        _move(sender, address(this), amount);
    }
}

/**
 * @title Balancer Pool Token
 * @author Balancer Labs
 * @notice Represents liquidity in Balancer pools
 */
contract BToken is BTokenBase {
    using SafeMath for uint256;

    // State variables

    string private _name = "Balancer Pool Token";
    string private _symbol = "BPT";
    uint8 private _decimals = 18;

    // Function declarations

    // External functions

    /**
     * @notice Getter for allowance: amount spender will be allowed to spend on behalf of owner
     * @param owner - owner of the tokens
     * @param spender - entity allowed to spend the tokens
     * @return remaining amount spender is allowed to transfer
     */
    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowance[owner][spender];
    }

    /**
     * @notice Getter for current account balance
     * @param account - address we're checking the balance of
     * @return token balance in the account
     */
    function balanceOf(address account) external view override returns (uint256) {
        return _balance[account];
    }

    /**
     * @notice Approve owner (sender) to spend a certain amount
     * @dev emits an Approval event
     * @param spender - entity the owner (sender) is approving to spend his tokens
     * @param amount - number of tokens being approved
     * @return bool - result of the approval (will always be true if it doesn't revert)
     */
    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowance[msg.sender][spender] = amount;

        emit Approval(msg.sender, spender, amount);

        return true;
    }

    /**
     * @notice Increase the amount the spender is allowed to spend on behalf of the owner (sender)
     * @dev emits an Approval event
     * @param spender - entity the owner (sender) is approving to spend his tokens
     * @param amount - number of tokens being approved
     * @return bool - result of the approval (will always be true if it doesn't revert)
     */
    function increaseApproval(address spender, uint256 amount) external returns (bool) {
        _allowance[msg.sender][spender] = _allowance[msg.sender][spender].add(amount);

        emit Approval(msg.sender, spender, _allowance[msg.sender][spender]);

        return true;
    }

    /**
     * @notice Decrease the amount the spender is allowed to spend on behalf of the owner (sender)
     * @dev emits an Approval event
     * @dev If you try to decrease it below the current limit, it's just set to zero (not an error)
     * @param spender - entity the owner (sender) is approving to spend his tokens
     * @param amount - number of tokens being approved
     * @return bool - result of the approval (will always be true if it doesn't revert)
     */
    function decreaseApproval(address spender, uint256 amount) external returns (bool) {
        uint256 oldValue = _allowance[msg.sender][spender];

        if (amount > oldValue) {
            _allowance[msg.sender][spender] = 0;
        } else {
            _allowance[msg.sender][spender] = oldValue.sub(amount);
        }

        emit Approval(msg.sender, spender, _allowance[msg.sender][spender]);

        return true;
    }

    /**
     * @notice Transfer the given amount from sender (caller) to recipient
     * @dev _move emits a Transfer event if successful
     * @param recipient - entity receiving the tokens
     * @param amount - number of tokens being transferred
     * @return bool - result of the transfer (will always be true if it doesn't revert)
     */
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _move(msg.sender, recipient, amount);

        return true;
    }

    /**
     * @notice Transfer the given amount from sender to recipient
     * @dev _move emits a Transfer event if successful; may also emit an Approval event
     * @param sender - entity sending the tokens (must be caller or allowed to spend on behalf of caller)
     * @param recipient - recipient of the tokens
     * @param amount - number of tokens being transferred
     * @return bool - result of the transfer (will always be true if it doesn't revert)
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override returns (bool) {
        require(msg.sender == sender || amount <= _allowance[sender][msg.sender], "ERR_BTOKEN_BAD_CALLER");

        _move(sender, recipient, amount);

        if (msg.sender != sender && _allowance[sender][msg.sender] != uint256(-1)) {
            _allowance[sender][msg.sender] = _allowance[sender][msg.sender].sub(amount);
            emit Approval(msg.sender, recipient, _allowance[sender][msg.sender]);
        }

        return true;
    }

    // Public functions

    /**
     * @notice Getter for the token name
     * @return token name
     */
    function name() public view returns (string memory) {
        return _name;
    }

    /**
     * @notice Getter for the token symbol
     * @return token symbol
     */
    function symbol() public view returns (string memory) {
        return _symbol;
    }

    /**
     * @notice Getter for the token decimals
     * @return token decimals
     */
    function decimals() public view returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Getter for the total supply
     * @dev declared external for gas optimization
     * @return total number of tokens in existence
     */
    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }
}
