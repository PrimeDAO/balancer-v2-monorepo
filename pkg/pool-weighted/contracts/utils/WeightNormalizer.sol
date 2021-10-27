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

        uint256 totalWeightFixedTokens; //combined weight of all tokens from _fixedWeights
        uint256 totalWeightBaseTokens; //combined weight of all tokens from _baseWeights
        uint256 totalWeight; //combined weight of all tokens from _baseWeights & _fixedWeights

        for (uint256 i = 0; i < numberTokens; i++) {
            if (_fixedWeights[i] != 0) {
                totalWeightFixedTokens += _fixedWeights[i];
                totalWeight += _fixedWeights[i];
            } else {
                totalWeight += _baseWeights[i];
                totalWeightBaseTokens += _baseWeights[i];
            }
        }

        /* 
            isDownScale is true if the base weights need to be scaled down
            example: pool with 80/20 is transformed to ?/?/1 => totalWeight = 101
            here the weights of the existing tokens need to be scaled down 
        */
        bool isDownScale = totalWeight > BONE;
        uint256 denormWeightDiff = isDownScale ? totalWeight - BONE : BONE - totalWeight;

        for (uint256 i = 0; i < numberTokens; i++) {
            // if fixedWeight is zero we can assume we are dealing with a token whose weight needs to be adjusted
            if (_fixedWeights[i] == 0) {
                /*
                    the logic is to derive the adjustmentAmount is:
                    (weight of base token / combined weight of all base tokens) *
                    (absolute diff between hundred and combined weights of base and fixed tokens / hundred)
                */
                uint256 adjustmentAmount = _bdiv(_baseWeights[i] * denormWeightDiff, totalWeightBaseTokens * BONE);

                // if base tokens needs to be scaled down we subtract the adjustmentAmount, else we add it
                normalizedWeights[i] = isDownScale
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
