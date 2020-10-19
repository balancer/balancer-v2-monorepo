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

// Interface contracts calling Vault's batchSwap function must implement.
interface ISwapCaller {
    // The Vault guarantees that this function will only ever be called back by the Vault in the context of the contract
    // having called batchSwap. The callbackData argument will be the equal to its namesake in batchSwap.
    //
    // The Vault will measure the balance of all tokens it expects to receive before and after calling sendTokens. This
    // is the only moment where tokens can be sent to the Vault in order for them to be acknowledged for a swap.
    function sendTokens(bytes calldata callbackData) external;
}
