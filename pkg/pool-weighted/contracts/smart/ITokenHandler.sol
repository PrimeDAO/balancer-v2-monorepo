// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

interface ITokenHandler {
    function setIndexPool(address) external;
    // function withdrawToken(bytes32, )
}
