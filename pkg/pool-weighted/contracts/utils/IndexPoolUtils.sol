//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

contract IndexPoolUtils {
    using FixedPoint for uint256;
    using Math for uint256;

    uint256 public constant PRECISION = 18;
    uint256 public constant HUNDRED_PERCENT = 10**PRECISION;

    /// @dev Can be used to scale the weights for tokens up or down so that the total weight is normalized.
    /// @param _baseWeights Array with weights of tokens. Those that are non-zero need to be scaled.
    /// @param _fixedWeights Array with weights of tokens. Those that are non-zero are fixed.
    /// @return Array with scaled and fixed weights of tokens. Should add up to one.
    function normalizeInterpolated(uint256[] memory _baseWeights, uint256[] memory _fixedWeights)
        public
        pure
        returns (uint256[] memory)
    {
        require(_baseWeights.length == _fixedWeights.length, "ARRAY_LENGTHS_DIFFER");
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
                uint256 adjustmentAmount = FixedPoint.divUp(
                    Math.mul(_baseWeights[i], denormWeightDiff),
                    Math.mul(totalWeightBaseTokens, HUNDRED_PERCENT)
                );

                // if base tokens needs to be scaled down we subtract the adjustmentAmount, else we add it
                normalizedWeights[i] = isDownScale
                    ? Math.sub(_baseWeights[i], adjustmentAmount)
                    : Math.add(_baseWeights[i], adjustmentAmount);
            } else {
                normalizedWeights[i] = _fixedWeights[i];
            }
            checksum += normalizedWeights[i];
        }

        // there are cases where due to rounding the sum of all normalizedWeights is slightly more than HUNDRED_PERCENT
        // the largest possible deviation I could observe was 2 (e.g. 1000000000000000002)
        // it can only be larger than HUNDRED_PERCENT since we use `diveUp`
        // in that case we remove the diff from the first weight to ensure normalized weights
        // since this diff is extremely small this shouldn't pose a risk
        if (checksum != HUNDRED_PERCENT) {
            normalizedWeights[0] = normalizedWeights[0] - (checksum - HUNDRED_PERCENT);
        }

        return normalizedWeights;
    }
}
