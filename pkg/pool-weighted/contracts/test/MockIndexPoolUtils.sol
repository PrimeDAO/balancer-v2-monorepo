//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "../utils/IndexPoolUtils.sol";

contract MockIndexPoolUtils is IndexPoolUtils {
    function normalizeInterpolated(uint256[] memory _baseWeights, uint256[] memory _fixedWeights)
        public
        pure
        returns (uint256[] memory)
    {
        return _normalizeInterpolated(_baseWeights, _fixedWeights);
    }

    function getUninitializedTokenWeight(uint256 _newTokenBalanceIn, uint256 _minimumBalance)
        public
        view
        returns (uint256)
    {
        return _getUninitializedTokenWeight(_newTokenBalanceIn, _minimumBalance);
    }
}
