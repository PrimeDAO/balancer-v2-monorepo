// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

interface IIndexPool {
    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address controller;
    }

    event WeightChange(
        IERC20[] tokens,
        uint256[] startWeights,
        uint256[] endWeights,
        uint256 startTime,
        uint256 endTime
    );
}
