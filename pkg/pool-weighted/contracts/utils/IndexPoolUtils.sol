//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "../smart/WeightCompression.sol";


library IndexPoolUtils {
    using FixedPoint for uint256;
//    using Math for uint256;
//    using SafeMath for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;

    uint256 internal constant _PRECISION = 18;
    uint256 internal constant _HUNDRED_PERCENT = 10**_PRECISION;
    uint256 internal constant _UNINITIALIZED_WEIGHT = _HUNDRED_PERCENT / 100;


    // Offsets for data elements in _tokenState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;


    uint256 private constant _SECONDS_IN_A_DAY = 86400;

    /// @dev Scales baseWeights up/down so that resulting weights array is normalized.
    /// @param _baseWeights Array with weights of tokens. Those that are non-zero need to be scaled.
    /// @param _fixedWeights Array with weights of tokens. Those that are non-zero are fixed.
    /// @return Array with scaled and fixed weights of tokens. Should add up to one.
    function normalizeInterpolated(uint256[] memory _baseWeights, uint256[] memory _fixedWeights)
        internal
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
                totalWeight = Math.add(totalWeight, _fixedWeights[i]);
                totalWeightFixedTokens = Math.add(totalWeightFixedTokens, _fixedWeights[i]);
            } else {
                totalWeight = Math.add(totalWeight, _baseWeights[i]);
                totalWeightBaseTokens = Math.add(totalWeightBaseTokens, _baseWeights[i]);
            }
        }

        /*
            isDownScale is true if the base weights need to be scaled down
            example: pool with 80/20 is transformed to ?/?/1 => totalWeight = 101
            here the weights of the existing tokens need to be scaled down
        */
        bool isDownScale = totalWeight > _HUNDRED_PERCENT;
        uint256 denormWeightDiff = isDownScale ? totalWeight - _HUNDRED_PERCENT : _HUNDRED_PERCENT - totalWeight;
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
                    Math.mul(totalWeightBaseTokens, _HUNDRED_PERCENT)
                );

                // if base tokens needs to be scaled down we subtract the adjustmentAmount, else we add it
                normalizedWeights[i] = isDownScale
                    ? Math.sub(_baseWeights[i], adjustmentAmount)
                    : Math.add(_baseWeights[i], adjustmentAmount);
            } else {
                normalizedWeights[i] = _fixedWeights[i];
            }
            checksum = Math.add(checksum, normalizedWeights[i]);
        }

        // there are cases where due to rounding the sum of all normalizedWeights is slightly less/more
        // then _HUNDRED_PERCENT the largest possible deviation I could observe was 19 (e.g. 1000000000000000019)
        // in that case we remove/add the diff from the first weight to ensure normalized weights
        // since this diff is extremely small (< 0.000000000001 %) this shouldn't pose a risk
        if (checksum != _HUNDRED_PERCENT) {
            normalizedWeights[0] = checksum > _HUNDRED_PERCENT
                ? Math.sub(normalizedWeights[0], (checksum - _HUNDRED_PERCENT))
                : Math.add(normalizedWeights[0], (_HUNDRED_PERCENT - checksum));
        }

        return normalizedWeights;
    }

    /// @dev Calculates weight used to calculate the price of an uninitialized token depending on its amount in pool.
    /// @param _tokenBalanceBeforeSwap Amount of uninitialized token in pool (before the swap)
    /// @param _minimumBalance Minimum balance set for the uninitialized token (= initialization threshold)
    /// @return Weight to be used to calculate the price of an uninitalized token.
    function getUninitializedTokenWeight(uint256 _tokenBalanceBeforeSwap, uint256 _minimumBalance)
        internal
        pure
        returns (uint256)
    {
        bool addPremium = _tokenBalanceBeforeSwap < _minimumBalance;

        // if minimum balance has not been met a slight premium is added to the weight to incentivize swaps
        // the formular for the resulting weight is:
        // 1% * (1 + (minimumBalance - newTokenBalanceIn) / (10 * minimumBalance))
        // if minimum balance is exceeded the weight is increased relative to the excess amount
        // the formular for the resulting weight is:
        // 1% * (1 + (minimumBalance - newTokenBalanceIn) / minimumBalance)
        uint256 scalingFactor = addPremium ? 10 : 1;

        uint256 balanceDiff = addPremium
            ? Math.sub(_minimumBalance, _tokenBalanceBeforeSwap)
            : Math.sub(_tokenBalanceBeforeSwap, _minimumBalance);

        uint256 incentivizationPercentage = FixedPoint.divUp(balanceDiff, (scalingFactor * _minimumBalance));
        uint256 incentivizationFactor = Math.add(_HUNDRED_PERCENT, incentivizationPercentage);

        return FixedPoint.mulUp(_UNINITIALIZED_WEIGHT, incentivizationFactor);
    }


    function _interpolateWeight(bytes32 tokenData, uint256 pctProgress) internal pure returns (uint256 finalWeight) {
        uint256 startWeight = tokenData.decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
        uint256 endWeight = tokenData.decodeUint32(_END_WEIGHT_OFFSET).uncompress32();

        if (pctProgress == 0 || startWeight == endWeight) return startWeight;
        if (pctProgress >= FixedPoint.ONE) return endWeight;

        if (startWeight > endWeight) {
            uint256 weightDelta = pctProgress.mulDown(startWeight.sub(endWeight));
            return startWeight.sub(weightDelta);
        } else {
            uint256 weightDelta = pctProgress.mulDown(endWeight.sub(startWeight));
            return startWeight.add(weightDelta);
        }
    }

    /// @dev Calculates the time horizon for a rebasing based on max weight change.
    /// @param tokens Array with addresses of tokens.
    /// @param desiredWeights Array with desired weights of tokens. Must be in same order.
    /// @return changeTime Time horizon for the rebalancing period
    function _calcReweighTime(IERC20[] memory tokens, uint256[] memory desiredWeights, uint256[] memory normalizedWeights)
    internal
    view
    returns (uint256 changeTime)
    {
        uint256 diff = 0;
        uint256 numTokens = tokens.length;

        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < numTokens; i++) {

            if (desiredWeights[i] > normalizedWeights[i]) {
                if (diff < desiredWeights[i].sub(normalizedWeights[i])) {
                    diff = desiredWeights[i].sub(normalizedWeights[i]);
                }
            } else {
                if (diff < normalizedWeights[i].sub(desiredWeights[i])) {
                    diff = normalizedWeights[i].sub(desiredWeights[i]);
                }
            }
            normalizedSum = normalizedSum.add(desiredWeights[i]);
        }

        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);
        changeTime = ((diff.mulDown(_SECONDS_IN_A_DAY)).divDown(FixedPoint.ONE)) * 100;
    }

}
