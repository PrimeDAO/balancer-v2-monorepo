//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "hardhat/console.sol";

contract IndexPoolUtils {
    uint256 public constant PRECISION = 18;
    uint256 public constant HUNDRED_PERCENT = 10**PRECISION;

    /// @dev Can be used to scale the weights for tokens up or down so that the total weight is normalized.
    /// @param _scaleWeights Array with weights of tokens. Those that are non-zero need to be scaled.
    /// @param _fixedWeights Array with weights of tokens. Those that are non-zero are fixed.
    /// @return Array with scaled and fixed weights of tokens. Should add up to one.
    function normalizeInterpolated(uint256[] memory _scaleWeights, uint256[] memory _fixedWeights)
        public
        view
        returns (uint256[] memory)
    {
        require(_scaleWeights.length == _fixedWeights.length, "ARRAY_LENGTHS_DIFFER");
        uint256 numberTokens = _scaleWeights.length;

        uint256[] memory normalizedWeights = new uint256[](numberTokens);

        uint256 totalWeightFixedTokens; //combined weight of all tokens from _fixedWeights
        uint256 totalWeightBaseTokens; //combined weight of all tokens from _scaleWeights
        uint256 totalWeight; //combined weight of all tokens from _scaleWeights & _fixedWeights

        for (uint256 i = 0; i < numberTokens; i++) {
            if (_fixedWeights[i] != 0) {
                totalWeightFixedTokens += _fixedWeights[i];
                totalWeight += _fixedWeights[i];
            } else {
                totalWeight += _scaleWeights[i];
                totalWeightBaseTokens += _scaleWeights[i];
            }
        }

        /* 
            isDownScale is true if the base weights need to be scaled down
            example: pool with 80/20 is transformed to ?/?/1 => totalWeight = 101
            here the weights of the existing tokens need to be scaled down 
        */
        bool isDownScale = totalWeight > HUNDRED_PERCENT;
        uint256 denormWeightDiff = isDownScale ? totalWeight - HUNDRED_PERCENT : HUNDRED_PERCENT - totalWeight;
        uint256 checksum = 0;
        for (uint256 i = 0; i < numberTokens; i++) {
            // if fixedWeight is zero we can assume we are dealing with a token whose weight needs to be adjusted
            if (_fixedWeights[i] == 0) {
                /*
                    the logic is to derive the adjustmentAmount is:
                    (weight of base token / combined weight of all base tokens) *
                    (absolute diff between hundred and combined weights of base and fixed tokens / hundred)
                */
                uint256 adjustmentAmount = _bdiv(
                    _scaleWeights[i] * denormWeightDiff,
                    totalWeightBaseTokens * HUNDRED_PERCENT
                );

                // if base tokens needs to be scaled down we subtract the adjustmentAmount, else we add it
                normalizedWeights[i] = isDownScale
                    ? _scaleWeights[i] - adjustmentAmount
                    : _scaleWeights[i] + adjustmentAmount;
            } else {
                normalizedWeights[i] = _fixedWeights[i];
            }
            checksum += normalizedWeights[i];
        }
        console.log(checksum);
        return normalizedWeights;
    }

    /// @dev This function was copied from balancer v1 (BMath.sol)
    function _bdiv(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "ERR_DIV_ZERO");
        uint256 c0 = a * HUNDRED_PERCENT;
        require(a == 0 || c0 / a == HUNDRED_PERCENT, "ERR_DIV_INTERNAL"); // bmul overflow
        uint256 c1 = c0 + (b / 2);
        require(c1 >= c0, "ERR_DIV_INTERNAL"); //  badd require
        uint256 c2 = c1 / b;
        return c2;
    }
}
