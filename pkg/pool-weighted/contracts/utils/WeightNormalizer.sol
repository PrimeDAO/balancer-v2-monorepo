//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "hardhat/console.sol";

contract WeightNormalizer {
    uint8 public constant PRECISION = 18;
    uint256 public constant BONE = 10**PRECISION;

    function normalizeInterpolated(uint256[] memory _baseWeights, uint256[] memory _fixedWeights)
        public
        view
        returns (uint256[] memory)
    {
        uint256 numberTokens = _baseWeights.length;

        uint256[] memory normalizedWeights = new uint256[](numberTokens);

        // identify tokens to be added
        bool[] memory areFixedTokens = new bool[](numberTokens);
        uint256 totalWeightFixedTokens;
        uint256 totalWeightBaseTokens;
        uint256 denormalizedTotalWeight;

        for (uint256 i = 0; i < numberTokens; i++) {
            if (_fixedWeights[i] != 0) {
                totalWeightFixedTokens += _fixedWeights[i];
                denormalizedTotalWeight += _fixedWeights[i];
                areFixedTokens[i] = true;
            } else {
                denormalizedTotalWeight += _baseWeights[i];
                totalWeightBaseTokens += _baseWeights[i];
            }
        }

        bool isUpwardAdustment = denormalizedTotalWeight > BONE;
        uint256 delta = isUpwardAdustment ? denormalizedTotalWeight - BONE : BONE - denormalizedTotalWeight;

        for (uint256 i = 0; i < numberTokens; i++) {
            if (!areFixedTokens[i]) {
                uint256 adjustmentAmount = _bdiv(_baseWeights[i] * delta, totalWeightBaseTokens * BONE);
                normalizedWeights[i] = isUpwardAdustment
                    ? _baseWeights[i] - adjustmentAmount
                    : _baseWeights[i] + adjustmentAmount;
            } else {
                normalizedWeights[i] = _fixedWeights[i];
            }
        }

        return normalizedWeights;
    }

    function _bdiv(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "ERR_DIV_ZERO");
        uint256 c0 = a * BONE;
        require(a == 0 || c0 / a == BONE, "ERR_DIV_INTERNAL"); // bmul overflow
        uint256 c1 = c0 + (b / 2);
        require(c1 >= c0, "ERR_DIV_INTERNAL"); //  badd require
        uint256 c2 = c1 / b;
        return c2;
    }
}
