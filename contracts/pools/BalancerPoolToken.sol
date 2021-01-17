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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../vendor/IERC20Permit.sol";
import "../vendor/Counters.sol";
import "../vendor/EIP712.sol";

// Contracts

/**
 * @title Highly opinionated token implementation
 * @author Balancer Labs
 * @dev
 * - Includes functions to increase and decrease allowance as a workaround
 *   for the well-known issue with `approve`:
 *   https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
 * - Allows for 'infinite allowance', where an allowance of 0xff..ff is not
 *   decreased by calls to transferFrom
 * - Lets a token holder use `transferFrom` to send their own tokens,
 *   without first setting allowance
 * - Emits 'Approval' events whenever allowance is changed by `transferFrom`
 */
contract BalancerPoolToken is IERC20, IERC20Permit, EIP712 {
    using Counters for Counters.Counter;
    using SafeMath for uint256;

    // State variables

    uint8 private constant _DECIMALS = 18;
    string private constant _VERSION = "1";
    bytes32 private constant _PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    mapping (address => Counters.Counter) private _nonces;

    mapping(address => uint256) private _balance;
    mapping(address => mapping(address => uint256)) private _allowance;
    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    // Function declarations

    constructor(string memory tokenName, string memory tokenSymbol) EIP712(tokenName, _VERSION) {
        _name = tokenName;
        _symbol = tokenSymbol;
    }

    // External functions

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowance[owner][spender];
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balance[account];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _setAllowance(msg.sender, spender, amount);

        return true;
    }

    function increaseApproval(address spender, uint256 amount) external returns (bool) {
        _setAllowance(msg.sender, spender, _allowance[msg.sender][spender].add(amount));

        return true;
    }

    function decreaseApproval(address spender, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowance[msg.sender][spender];

        if (amount >= currentAllowance) {
            _setAllowance(msg.sender, spender, 0);
        } else {
            _setAllowance(msg.sender, spender, currentAllowance.sub(amount));
        }

        return true;
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _move(msg.sender, recipient, amount);

        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override returns (bool) {
        require(msg.sender == sender || amount <= _allowance[sender][msg.sender], "ERR_BPT_BAD_CALLER");

        _move(sender, recipient, amount);

        // memoize for gas optimization
        uint256 oldAllowance = _allowance[sender][msg.sender];

        if (msg.sender != sender && oldAllowance != uint256(-1)) {
            _setAllowance(sender, msg.sender, oldAllowance.sub(amount, "ERR_INSUFFICIENT_ALLOWANCE"));
        }

        return true;
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "BalancerV2: EXPIRED");

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparatorV4(),
                keccak256(abi.encode(_PERMIT_TYPEHASH, owner, spender, value, _nonces[owner].current(), deadline))
            )
        );

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "BalancerV2: INVALID_SIGNATURE");

        _nonces[owner].increment();
        
        _setAllowance(owner, spender, value);
    }

    function nonces(address owner) external view override returns (uint256) {
        return _nonces[owner].current();
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    // Public functions

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public pure returns (uint8) {
        return _DECIMALS;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    // Internal functions

    function _mintPoolTokens(address recipient, uint256 amount) internal {
        _balance[address(this)] = _balance[address(this)].add(amount);
        _totalSupply = _totalSupply.add(amount);

        _move(address(this), recipient, amount);

        emit Transfer(address(0), recipient, amount);
    }

    function _burnPoolTokens(address sender, uint256 amount) internal {
        _move(sender, address(this), amount);

        _balance[address(this)] = _balance[address(this)].sub(amount, "ERR_INSUFFICIENT_BAL");
        _totalSupply = _totalSupply.sub(amount);

        emit Transfer(sender, address(0), amount);
    }

    function _move(
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        _balance[sender] = _balance[sender].sub(amount, "ERR_INSUFFICIENT_BAL");
        _balance[recipient] = _balance[recipient].add(amount);

        emit Transfer(sender, recipient, amount);
    }

    // Private functions

    function _setAllowance(
        address owner,
        address spender,
        uint256 amount
    ) private {
        _allowance[owner][spender] = amount;

        emit Approval(owner, spender, amount);
    }
}
