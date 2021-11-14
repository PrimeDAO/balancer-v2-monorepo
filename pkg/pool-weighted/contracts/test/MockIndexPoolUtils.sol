//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "../utils/IndexPoolUtils.sol";

contract MockIndexPoolUtils {
    function normalizeInterpolatedMock(uint256[] memory _baseWeights, uint256[] memory _fixedWeights)
        public
        pure
        returns (uint256[] memory)
    {
        return IndexPoolUtils.normalizeInterpolated(_baseWeights, _fixedWeights);
    }

    function getUninitializedTokenWeightMock(uint256 _newTokenBalanceIn, uint256 _minimumBalance)
        public
        pure
        returns (uint256)
    {
        return IndexPoolUtils.getUninitializedTokenWeight(_newTokenBalanceIn, _minimumBalance);
    }

    function getAdjustedNewStartWeight(
        uint256 _balanceIn,
        uint256 _minimumBalance,
        uint256 _amount
    ) public pure returns (uint256) {
        return IndexPoolUtils.getAdjustedNewStartWeight(_balanceIn, _minimumBalance, _amount);
    }
}
