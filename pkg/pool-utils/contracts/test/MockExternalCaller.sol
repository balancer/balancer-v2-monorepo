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

pragma solidity ^0.7.0;

import "./MaliciousQueryReverter.sol";
import "../lib/ExternalCallLib.sol";

contract MockExternalCaller {
    MaliciousQueryReverter maliciousCallee;

    constructor(MaliciousQueryReverter callee) {
        maliciousCallee = callee;
    }

    function protectedExternalCall() external payable {
        try maliciousCallee.maybeRevertMaliciously()  {} catch (bytes memory revertdata) {
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertdata);
        }
    }

    function unprotectedExternalCall() external payable {
        maliciousCallee.maybeRevertMaliciously();
    }
}
