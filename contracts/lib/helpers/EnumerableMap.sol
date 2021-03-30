// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

// Based on the EnumerableSet library from OpenZeppelin contracts, altered to include
// the following:
//  * a map from IERC20 to bytes32
//  * entries are stored in mappings instead of arrays, reducing implicit storage reads for out-of-bounds checks
//  * _unchecked_at and _unchecked_valueAt, which allow for more gas efficient data reads in some scenarios
//  * _indexOf and _unchecked_setAt, which allow for more gas efficient data writes in some scenarios

// We're using non-standard casing for the unchecked functions to differentiate them, so we need to turn off that rule
// solhint-disable func-name-mixedcase

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BalancerErrors.sol";

/**
 * @dev Library for managing an enumerable variant of Solidity's
 * https://solidity.readthedocs.io/en/latest/types.html#mapping-types[`mapping`]
 * type.
 *
 * Maps have the following properties:
 *
 * - Entries are added, removed, and checked for existence in constant time
 * (O(1)).
 * - Entries are enumerated in O(n). No guarantees are made on the ordering.
 *
 * ```
 * contract Example {
 *     // Add the library methods
 *     using EnumerableMap for EnumerableMap.UintToAddressMap;
 *
 *     // Declare a set state variable
 *     EnumerableMap.UintToAddressMap private myMap;
 * }
 * ```
 */
library EnumerableMap {
    // To implement this library for multiple types with as little code
    // repetition as possible, we write it in terms of a generic Map type with
    // bytes32 keys and values.
    // The Map implementation uses private functions, and user-facing
    // implementations (such as Uint256ToAddressMap) are just wrappers around
    // the underlying Map.
    // This means that we can only create new EnumerableMaps for types that fit
    // in bytes32.

    struct MapEntry {
        bytes32 _key;
        bytes32 _value;
    }

    struct Map {
        // Number of entries in the map
        uint256 _length;
        // Storage of map keys and values
        mapping(uint256 => MapEntry) _entries;
        // Position of the entry defined by a key in the `entries` array, plus 1
        // because index 0 means a key is not in the map.
        mapping(bytes32 => uint256) _indexes;
    }

    /**
     * @dev Adds a key-value pair to a map, or updates the value for an existing
     * key. O(1).
     *
     * Returns true if the key was added to the map, that is if it was not
     * already present.
     */
    function _set(
        Map storage map,
        bytes32 key,
        bytes32 value
    ) private returns (bool) {
        // We read and store the key's index to prevent multiple reads from the same storage slot
        uint256 keyIndex = map._indexes[key];

        // Equivalent to !contains(map, key)
        if (keyIndex == 0) {
            uint256 previousLength = map._length;
            map._entries[previousLength] = MapEntry({ _key: key, _value: value });
            map._length = previousLength + 1;

            // The entry is stored at previousLength, but we add 1 to all indexes
            // and use 0 as a sentinel value
            map._indexes[key] = previousLength + 1;
            return true;
        } else {
            map._entries[keyIndex - 1]._value = value;
            return false;
        }
    }

    /**
     * @dev Returns the index for `key`, which can be used alongside the {at} family of functions, including critically
     * {unchecked_setAt}. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function _indexOf(Map storage map, bytes32 key) private view returns (uint256) {
        return _indexOf(map, key, Errors.OUT_OF_BOUNDS);
    }

    /**
     * @dev Same as {_indexOf}, with a custom error message when `key` is not in the map.
     */
    function _indexOf(
        Map storage map,
        bytes32 key,
        uint256 errorCode
    ) private view returns (uint256) {
        uint256 index = map._indexes[key];
        _require(index > 0, errorCode);
        return index - 1;
    }

    /**
     * @dev Updates the value for an entry, given its key's index. The key index can be retrieved via {indexOf}, and it
     * should be noted that key indices may change when calling {add} or {remove}. O(1).
     *
     * This function performs one less storage read than {set}, but it should only be used when `index` is known to be
     * within bounds.
     */
    function _unchecked_setAt(
        Map storage map,
        uint256 index,
        bytes32 value
    ) private {
        map._entries[index]._value = value;
    }

    /**
     * @dev Removes a key-value pair from a map. O(1).
     *
     * Returns true if the key was removed from the map, that is if it was present.
     */
    function _remove(Map storage map, bytes32 key) private returns (bool) {
        // We read and store the key's index to prevent multiple reads from the same storage slot
        uint256 keyIndex = map._indexes[key];

        // Equivalent to contains(map, key)
        if (keyIndex != 0) {
            // To delete a key-value pair from the _entries pseudo-array in O(1), we swap the entry to delete with the
            // one at the highest index, and then remove this last entry (sometimes called as 'swap and pop').
            // This modifies the order of the pseudo-array, as noted in {at}.

            uint256 toDeleteIndex = keyIndex - 1;
            uint256 lastIndex = map._length - 1;

            // When the entry to delete is the last one, the swap operation is unnecessary. However, since this occurs
            // so rarely, we still do the swap anyway to avoid the gas cost of adding an 'if' statement.

            MapEntry storage lastEntry = map._entries[lastIndex];

            // Move the last entry to the index where the entry to delete is
            map._entries[toDeleteIndex] = lastEntry;
            // Update the index for the moved entry
            map._indexes[lastEntry._key] = toDeleteIndex + 1; // All indexes are 1-based

            // Delete the slot where the moved entry was stored
            delete map._entries[lastIndex];
            map._length = lastIndex;

            // Delete the index for the deleted slot
            delete map._indexes[key];

            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Returns true if the key is in the map. O(1).
     */
    function _contains(Map storage map, bytes32 key) private view returns (bool) {
        return map._indexes[key] != 0;
    }

    /**
     * @dev Returns the number of key-value pairs in the map. O(1).
     */
    function _length(Map storage map) private view returns (uint256) {
        return map._length;
    }

    /**
     * @dev Returns the key-value pair stored at position `index` in the map. O(1).
     *
     * Note that there are no guarantees on the ordering of entries inside the
     * array, and it may change when more entries are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function _at(Map storage map, uint256 index) private view returns (bytes32, bytes32) {
        _require(map._length > index, Errors.OUT_OF_BOUNDS);

        MapEntry storage entry = map._entries[index];
        return (entry._key, entry._value);
    }

    /**
     * @dev Same as {at}, except this doesn't revert if `index` it outside of the map (i.e. if it is
     * equal or larger than {length}). O(1).
     *
     * This function performs one less storage read than {at}, but should only be used when `index` is known to be
     * within bounds.
     */
    function _unchecked_at(Map storage map, uint256 index) private view returns (bytes32, bytes32) {
        MapEntry storage entry = map._entries[index];
        return (entry._key, entry._value);
    }

    /**
     * @dev Same as {unchecked_valueAt}, except it only returns the value and not the key (performing one less storage
     * read). O(1).
     */
    function _unchecked_valueAt(Map storage map, uint256 index) private view returns (bytes32) {
        return map._entries[index]._value;
    }

    /**
     * @dev Returns the value associated with `key`. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function _get(Map storage map, bytes32 key) private view returns (bytes32) {
        return _get(map, key, Errors.OUT_OF_BOUNDS);
    }

    /**
     * @dev Same as {_get}, with a custom error message when `key` is not in the map.
     */
    function _get(
        Map storage map,
        bytes32 key,
        uint256 errorCode
    ) private view returns (bytes32) {
        uint256 index = _indexOf(map, key, errorCode);
        return _unchecked_valueAt(map, index);
    }

    // UintToAddressMap

    struct UintToAddressMap {
        Map _inner;
    }

    /**
     * @dev Adds a key-value pair to a map, or updates the value for an existing
     * key. O(1).
     *
     * Returns true if the key was added to the map, that is if it was not
     * already present.
     */
    function set(
        UintToAddressMap storage map,
        uint256 key,
        address value
    ) internal returns (bool) {
        return _set(map._inner, bytes32(key), bytes32(uint256(value)));
    }

    /**
     * @dev Returns the index for `key`, which can be used alongside the {at} family of functions, including critically
     * {unchecked_setAt}. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function indexOf(UintToAddressMap storage map, uint256 key) internal view returns (uint256) {
        return _indexOf(map._inner, bytes32(uint256(address(key))));
    }

    /**
     * @dev Updates the value for an entry, given its key's index. The key index can be retrieved via {indexOf}, and it
     * should be noted that key indices may change when calling {add} or {remove}. O(1).
     *
     * This function performs one less storage read than {set}, but it should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_setAt(
        UintToAddressMap storage map,
        uint256 index,
        address value
    ) internal {
        _unchecked_setAt(map._inner, index, bytes32(uint256(value)));
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the key was removed from the map, that is if it was present.
     */
    function remove(UintToAddressMap storage map, uint256 key) internal returns (bool) {
        return _remove(map._inner, bytes32(key));
    }

    /**
     * @dev Returns true if the key is in the map. O(1).
     */
    function contains(UintToAddressMap storage map, uint256 key) internal view returns (bool) {
        return _contains(map._inner, bytes32(key));
    }

    /**
     * @dev Returns the number of elements in the map. O(1).
     */
    function length(UintToAddressMap storage map) internal view returns (uint256) {
        return _length(map._inner);
    }

    /**
     * @dev Returns the element stored at position `index` in the set. O(1).
     * Note that there are no guarantees on the ordering of values inside the
     * array, and it may change when more values are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function at(UintToAddressMap storage map, uint256 index) internal view returns (uint256, address) {
        (bytes32 key, bytes32 value) = _at(map._inner, index);
        return (uint256(key), address(uint256(value)));
    }

    /**
     * @dev Same as {at}, except this doesn't revert if `index` it outside of the map (i.e. if it is
     * equal or larger than {length}). O(1).
     *
     * This function performs one less storage read than {at}, but should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_at(UintToAddressMap storage map, uint256 index) internal view returns (uint256, address) {
        (bytes32 key, bytes32 value) = _unchecked_at(map._inner, index);
        return (uint256(key), address(uint256(value)));
    }

    /**
     * @dev Same as {unchecked_valueAt}, except it only returns the value and not the key (performing one less storage
     * read). O(1).
     */
    function unchecked_valueAt(UintToAddressMap storage map, uint256 index) internal view returns (address) {
        return address(uint256(_unchecked_valueAt(map._inner, index)));
    }

    /**
     * @dev Returns the value associated with `key`.  O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function get(UintToAddressMap storage map, uint256 key) internal view returns (address) {
        return address(uint256(_get(map._inner, bytes32(key))));
    }

    /**
     * @dev Same as {get}, with a custom error message when `key` is not in the map.
     */
    function get(
        UintToAddressMap storage map,
        uint256 key,
        uint256 errorCode
    ) internal view returns (address) {
        return address(uint256(_get(map._inner, bytes32(key), errorCode)));
    }

    // IERC20ToBytes32Map

    struct IERC20ToBytes32Map {
        Map _inner;
    }

    /**
     * @dev Adds a key-value pair to a map, or updates the value for an existing
     * key. O(1).
     *
     * Returns true if the key was added to the map, that is if it was not
     * already present.
     */
    function set(
        IERC20ToBytes32Map storage map,
        IERC20 key,
        bytes32 value
    ) internal returns (bool) {
        return _set(map._inner, bytes32(uint256(address(key))), value);
    }

    /**
     * @dev Returns the index for `key`, which can be used alongside the {at} family of functions, including critically
     * {unchecked_setAt}. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function indexOf(IERC20ToBytes32Map storage map, IERC20 key) internal view returns (uint256) {
        return _indexOf(map._inner, bytes32(uint256(address(key))));
    }

    /**
     * @dev Same as {indexOf}, with a custom error message when `key` is not in the map.
     */
    function indexOf(
        IERC20ToBytes32Map storage map,
        IERC20 key,
        uint256 errorCode
    ) internal view returns (uint256) {
        return _indexOf(map._inner, bytes32(uint256(address(key))), errorCode);
    }

    /**
     * @dev Returns the index for `key` without checking if the key was in the map. It will return 0 in case it wasn't.
     */
    function unchecked_indexOf(IERC20ToBytes32Map storage map, IERC20 key) internal view returns (uint256) {
        return map._inner._indexes[bytes32(uint256(address(key)))];
    }

    /**
     * @dev Updates the value for an entry, given its key's index. The key index can be retrieved via {indexOf}, and it
     * should be noted that key indices may change when calling {add} or {remove}. O(1).
     *
     * This function performs one less storage read than {set}, but it should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_setAt(
        IERC20ToBytes32Map storage map,
        uint256 index,
        bytes32 value
    ) internal {
        _unchecked_setAt(map._inner, index, value);
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the key was removed from the map, that is if it was present.
     */
    function remove(IERC20ToBytes32Map storage map, IERC20 key) internal returns (bool) {
        return _remove(map._inner, bytes32(uint256(address(key))));
    }

    /**
     * @dev Returns true if the key is in the map. O(1).
     */
    function contains(IERC20ToBytes32Map storage map, IERC20 key) internal view returns (bool) {
        return _contains(map._inner, bytes32(uint256(address(key))));
    }

    /**
     * @dev Returns the number of elements in the map. O(1).
     */
    function length(IERC20ToBytes32Map storage map) internal view returns (uint256) {
        return _length(map._inner);
    }

    /**
     * @dev Returns the element stored at position `index` in the set. O(1).
     * Note that there are no guarantees on the ordering of values inside the
     * array, and it may change when more values are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function at(IERC20ToBytes32Map storage map, uint256 index) internal view returns (IERC20, bytes32) {
        (bytes32 key, bytes32 value) = _at(map._inner, index);
        return (IERC20(uint256(key)), value);
    }

    /**
     * @dev Same as {at}, except this doesn't revert if `index` it outside of the map (i.e. if it is
     * equal or larger than {length}). O(1).
     *
     * This function performs one less storage read than {at}, but should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_at(IERC20ToBytes32Map storage map, uint256 index) internal view returns (IERC20, bytes32) {
        (bytes32 key, bytes32 value) = _unchecked_at(map._inner, index);
        return (IERC20(uint256(key)), value);
    }

    /**
     * @dev Same as {unchecked_valueAt}, except it only returns the value and not the key (performing one less storage
     * read). O(1).
     */
    function unchecked_valueAt(IERC20ToBytes32Map storage map, uint256 index) internal view returns (bytes32) {
        return _unchecked_valueAt(map._inner, index);
    }

    /**
     * @dev Returns the value associated with `key`. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function get(IERC20ToBytes32Map storage map, IERC20 key) internal view returns (bytes32) {
        return _get(map._inner, bytes32(uint256(address(key))));
    }

    /**
     * @dev Returns the value associated with `key`. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function get(
        IERC20ToBytes32Map storage map,
        IERC20 key,
        uint256 errorCode
    ) internal view returns (bytes32) {
        return _get(map._inner, bytes32(uint256(address(key))), errorCode);
    }
}
