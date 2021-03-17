// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../lib/helpers/EnumerableMap.sol";

// solhint-disable func-name-mixedcase

contract EnumerableUintToAddressMapMock {
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    event OperationResult(bool result);

    EnumerableMap.UintToAddressMap private _map;

    function contains(uint256 key) public view returns (bool) {
        return _map.contains(key);
    }

    function set(uint256 key, address value) public {
        bool result = _map.set(key, value);
        emit OperationResult(result);
    }

    function indexOf(uint256 key) public view returns (uint256) {
        return _map.indexOf(key);
    }

    function unchecked_setAt(uint256 index, address value) public {
        _map.unchecked_setAt(index, value);
    }

    function remove(uint256 key) public {
        bool result = _map.remove(key);
        emit OperationResult(result);
    }

    function length() public view returns (uint256) {
        return _map.length();
    }

    function at(uint256 index) public view returns (uint256 key, address value) {
        return _map.at(index);
    }

    function unchecked_at(uint256 index) public view returns (uint256 key, address value) {
        return _map.unchecked_at(index);
    }

    function unchecked_valueAt(uint256 index) public view returns (address value) {
        return _map.unchecked_valueAt(index);
    }

    function get(uint256 key) public view returns (address) {
        return _map.get(key);
    }
}

contract EnumerableIERC20ToBytes32MapMock {
    using EnumerableMap for EnumerableMap.IERC20ToBytes32Map;

    event OperationResult(bool result);

    EnumerableMap.IERC20ToBytes32Map private _map;

    function contains(IERC20 key) public view returns (bool) {
        return _map.contains(key);
    }

    function set(IERC20 key, bytes32 value) public {
        bool result = _map.set(key, value);
        emit OperationResult(result);
    }

    function indexOf(IERC20 key) public view returns (uint256) {
        return _map.indexOf(key);
    }

    function unchecked_setAt(uint256 index, bytes32 value) public {
        _map.unchecked_setAt(index, value);
    }

    function remove(IERC20 key) public {
        bool result = _map.remove(key);
        emit OperationResult(result);
    }

    function length() public view returns (uint256) {
        return _map.length();
    }

    function at(uint256 index) public view returns (IERC20 key, bytes32 value) {
        return _map.at(index);
    }

    function unchecked_at(uint256 index) public view returns (IERC20 key, bytes32 value) {
        return _map.unchecked_at(index);
    }

    function unchecked_valueAt(uint256 index) public view returns (bytes32 value) {
        return _map.unchecked_valueAt(index);
    }

    function get(IERC20 key) public view returns (bytes32) {
        return _map.get(key);
    }
}
