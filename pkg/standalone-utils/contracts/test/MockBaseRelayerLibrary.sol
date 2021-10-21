// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2015, 2016, 2017 Dapphub

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

pragma solidity ^0.7.0;

import "../relayer/BaseRelayerLibrary.sol";

contract MockBaseRelayerLibrary is BaseRelayerLibrary {
    event TempStorageRead(uint256 value);

    constructor(IVault vault) BaseRelayerLibrary(vault) {}

    function isAmountChainedReference(uint256 amount) public pure returns (bool) {
        return _isAmountChainedReference(amount);
    }

    function getChainedReferenceKey(uint256 ref) public pure returns (uint256) {
        return _getChainedReferenceKey(ref);
    }

    function writeTempStorage(uint256 key, uint256 value) external {
        _writeTempStorage(key, value);
    }

    function readTempStorage(uint256 key) external {
        emit TempStorageRead(_readTempStorage(key));
    }
}
