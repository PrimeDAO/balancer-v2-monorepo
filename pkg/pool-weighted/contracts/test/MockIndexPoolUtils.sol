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

}
