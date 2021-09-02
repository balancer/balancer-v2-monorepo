// SPDX-License-Identifier: MIT

// Based on the EnumerableMap library from OpenZeppelin Contracts, altered to include the following:
//  * a map from IERC20 to bytes32
//  * entries are stored in mappings instead of arrays, reducing implicit storage reads for out-of-bounds checks
//  * unchecked_at and unchecked_valueAt, which allow for more gas efficient data reads in some scenarios
//  * indexOf, unchecked_indexOf and unchecked_setAt, which allow for more gas efficient data writes in some scenarios
//
// Additionally, the base private functions that work on bytes32 were removed and replaced with a native implementation
// for IERC20 keys, to reduce bytecode size and runtime costs.

pragma solidity ^0.7.0;

import "./IERC20.sol";

import "../helpers/BalancerErrors.sol";

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
    // The original OpenZeppelin implementation uses a generic Map type with bytes32 keys: this was replaced with
    // IERC20ToBytes32Map and IERC20ToUint256Map, resulting in more dense bytecode (as long as each contract only uses
    // one of these - there'll otherwise be duplicated code).

    // IERC20ToBytes32Map

    struct IERC20ToBytes32MapEntry {
        IERC20 _key;
        bytes32 _value;
    }

    struct IERC20ToBytes32Map {
        // Number of entries in the map
        uint256 _length;
        // Storage of map keys and values
        mapping(uint256 => IERC20ToBytes32MapEntry) _entries;
        // Position of the entry defined by a key in the `entries` array, plus 1
        // because index 0 means a key is not in the map.
        mapping(IERC20 => uint256) _indexes;
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
        // We read and store the key's index to prevent multiple reads from the same storage slot
        uint256 keyIndex = map._indexes[key];

        // Equivalent to !contains(map, key)
        if (keyIndex == 0) {
            uint256 previousLength = map._length;
            map._entries[previousLength] = IERC20ToBytes32MapEntry({ _key: key, _value: value });
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
     * @dev Updates the value for an entry, given its key's index. The key index can be retrieved via
     * {unchecked_indexOf}, and it should be noted that key indices may change when calling {set} or {remove}. O(1).
     *
     * This function performs one less storage read than {set}, but it should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_setAt(
        IERC20ToBytes32Map storage map,
        uint256 index,
        bytes32 value
    ) internal {
        map._entries[index]._value = value;
    }

    /**
     * @dev Removes a key-value pair from a map. O(1).
     *
     * Returns true if the key was removed from the map, that is if it was present.
     */
    function remove(IERC20ToBytes32Map storage map, IERC20 key) internal returns (bool) {
        // We read and store the key's index to prevent multiple reads from the same storage slot
        uint256 keyIndex = map._indexes[key];

        // Equivalent to contains(map, key)
        if (keyIndex != 0) {
            // To delete a key-value pair from the _entries pseudo-array in O(1), we swap the entry to delete with the
            // one at the highest index, and then remove this last entry (sometimes called as 'swap and pop').
            // This modifies the order of the pseudo-array, as noted in {at}.

            uint256 toDeleteIndex = keyIndex - 1;
            uint256 lastIndex = map._length - 1;

            // The swap is only necessary if we're not removing the last element
            if (toDeleteIndex != lastIndex) {
                IERC20ToBytes32MapEntry storage lastEntry = map._entries[lastIndex];

                // Move the last entry to the index where the entry to delete is
                map._entries[toDeleteIndex] = lastEntry;
                // Update the index for the moved entry
                map._indexes[lastEntry._key] = toDeleteIndex + 1; // All indexes are 1-based
            }

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
    function contains(IERC20ToBytes32Map storage map, IERC20 key) internal view returns (bool) {
        return map._indexes[key] != 0;
    }

    /**
     * @dev Returns the number of key-value pairs in the map. O(1).
     */
    function length(IERC20ToBytes32Map storage map) internal view returns (uint256) {
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
    function at(IERC20ToBytes32Map storage map, uint256 index) internal view returns (IERC20, bytes32) {
        _require(map._length > index, Errors.OUT_OF_BOUNDS);
        return unchecked_at(map, index);
    }

    /**
     * @dev Same as {at}, except this doesn't revert if `index` it outside of the map (i.e. if it is equal or larger
     * than {length}). O(1).
     *
     * This function performs one less storage read than {at}, but should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_at(IERC20ToBytes32Map storage map, uint256 index) internal view returns (IERC20, bytes32) {
        IERC20ToBytes32MapEntry storage entry = map._entries[index];
        return (entry._key, entry._value);
    }

    /**
     * @dev Same as {unchecked_At}, except it only returns the value and not the key (performing one less storage
     * read). O(1).
     */
    function unchecked_valueAt(IERC20ToBytes32Map storage map, uint256 index) internal view returns (bytes32) {
        return map._entries[index]._value;
    }

    /**
     * @dev Returns the value associated with `key`. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map. Reverts with `errorCode` otherwise.
     */
    function get(
        IERC20ToBytes32Map storage map,
        IERC20 key,
        uint256 errorCode
    ) internal view returns (bytes32) {
        uint256 index = map._indexes[key];
        _require(index > 0, errorCode);
        return unchecked_valueAt(map, index - 1);
    }

    /**
     * @dev Returns the index for `key`.
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function indexOf(
        IERC20ToBytes32Map storage map,
        IERC20 key,
        uint256 errorCode
    ) internal view returns (uint256) {
        uint256 uncheckedIndex = unchecked_indexOf(map, key);
        _require(uncheckedIndex != 0, errorCode);
        return uncheckedIndex - 1;
    }

    /**
     * @dev Returns the index for `key` **plus one**. Does not revert if the key is not in the map, and returns 0
     * instead.
     */
    function unchecked_indexOf(IERC20ToBytes32Map storage map, IERC20 key) internal view returns (uint256) {
        return map._indexes[key];
    }

    // IERC20ToUint256Map

    struct IERC20ToUint256MapEntry {
        IERC20 _key;
        uint256 _value;
    }

    struct IERC20ToUint256Map {
        // Number of entries in the map
        uint256 _length;
        // Storage of map keys and values
        mapping(uint256 => IERC20ToUint256MapEntry) _entries;
        // Position of the entry defined by a key in the `entries` array, plus 1
        // because index 0 means a key is not in the map.
        mapping(IERC20 => uint256) _indexes;
    }

    /**
     * @dev Adds a key-value pair to a map, or updates the value for an existing
     * key. O(1).
     *
     * Returns true if the key was added to the map, that is if it was not
     * already present.
     */
    function set(
        IERC20ToUint256Map storage map,
        IERC20 key,
        uint256 value
    ) internal returns (bool) {
        // We read and store the key's index to prevent multiple reads from the same storage slot
        uint256 keyIndex = map._indexes[key];

        // Equivalent to !contains(map, key)
        if (keyIndex == 0) {
            uint256 previousLength = map._length;
            map._entries[previousLength] = IERC20ToUint256MapEntry({ _key: key, _value: value });
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
     * @dev Updates the value for an entry, given its key's index. The key index can be retrieved via
     * {unchecked_indexOf}, and it should be noted that key indices may change when calling {set} or {remove}. O(1).
     *
     * This function performs one less storage read than {set}, but it should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_setAt(
        IERC20ToUint256Map storage map,
        uint256 index,
        uint256 value
    ) internal {
        map._entries[index]._value = value;
    }

    /**
     * @dev Removes a key-value pair from a map. O(1).
     *
     * Returns true if the key was removed from the map, that is if it was present.
     */
    function remove(IERC20ToUint256Map storage map, IERC20 key) internal returns (bool) {
        // We read and store the key's index to prevent multiple reads from the same storage slot
        uint256 keyIndex = map._indexes[key];

        // Equivalent to contains(map, key)
        if (keyIndex != 0) {
            // To delete a key-value pair from the _entries pseudo-array in O(1), we swap the entry to delete with the
            // one at the highest index, and then remove this last entry (sometimes called as 'swap and pop').
            // This modifies the order of the pseudo-array, as noted in {at}.

            uint256 toDeleteIndex = keyIndex - 1;
            uint256 lastIndex = map._length - 1;

            // The swap is only necessary if we're not removing the last element
            if (toDeleteIndex != lastIndex) {
                IERC20ToUint256MapEntry storage lastEntry = map._entries[lastIndex];

                // Move the last entry to the index where the entry to delete is
                map._entries[toDeleteIndex] = lastEntry;
                // Update the index for the moved entry
                map._indexes[lastEntry._key] = toDeleteIndex + 1; // All indexes are 1-based
            }

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
    function contains(IERC20ToUint256Map storage map, IERC20 key) internal view returns (bool) {
        return map._indexes[key] != 0;
    }

    /**
     * @dev Returns the number of key-value pairs in the map. O(1).
     */
    function length(IERC20ToUint256Map storage map) internal view returns (uint256) {
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
    function at(IERC20ToUint256Map storage map, uint256 index) internal view returns (IERC20, uint256) {
        _require(map._length > index, Errors.OUT_OF_BOUNDS);
        return unchecked_at(map, index);
    }

    /**
     * @dev Same as {at}, except this doesn't revert if `index` it outside of the map (i.e. if it is equal or larger
     * than {length}). O(1).
     *
     * This function performs one less storage read than {at}, but should only be used when `index` is known to be
     * within bounds.
     */
    function unchecked_at(IERC20ToUint256Map storage map, uint256 index) internal view returns (IERC20, uint256) {
        IERC20ToUint256MapEntry storage entry = map._entries[index];
        return (entry._key, entry._value);
    }

    /**
     * @dev Same as {unchecked_At}, except it only returns the value and not the key (performing one less storage
     * read). O(1).
     */
    function unchecked_valueAt(IERC20ToUint256Map storage map, uint256 index) internal view returns (uint256) {
        return map._entries[index]._value;
    }

    /**
     * @dev Returns the value associated with `key`. O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map. Reverts with `errorCode` otherwise.
     */
    function get(
        IERC20ToUint256Map storage map,
        IERC20 key,
        uint256 errorCode
    ) internal view returns (uint256) {
        uint256 index = map._indexes[key];
        _require(index > 0, errorCode);
        return unchecked_valueAt(map, index - 1);
    }

    /**
     * @dev Returns the index for `key`.
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function indexOf(
        IERC20ToUint256Map storage map,
        IERC20 key,
        uint256 errorCode
    ) internal view returns (uint256) {
        uint256 uncheckedIndex = unchecked_indexOf(map, key);
        _require(uncheckedIndex != 0, errorCode);
        return uncheckedIndex - 1;
    }

    /**
     * @dev Returns the index for `key` **plus one**. Does not revert if the key is not in the map, and returns 0
     * instead.
     */
    function unchecked_indexOf(IERC20ToUint256Map storage map, IERC20 key) internal view returns (uint256) {
        return map._indexes[key];
    }
}
