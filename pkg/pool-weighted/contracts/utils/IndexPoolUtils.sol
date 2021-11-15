//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "hardhat/console.sol";

library IndexPoolUtils {
    using FixedPoint for uint256;
    using Math for uint256;
    using WordCodec for bytes32;

    uint256 internal constant _PRECISION = 18;
    uint256 internal constant _HUNDRED_PERCENT = 10**_PRECISION;
    uint256 internal constant _UNINITIALIZED_WEIGHT = _HUNDRED_PERCENT / 100;
    uint256 private constant _INITIAL_WEIGHT = 10**16;

    // Offsets for data elements in _tokenState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 96;
    uint256 private constant _UNINITIALIZED_OFFSET = 101;
    uint256 private constant _NEW_TOKEN_TARGET_WEIGHT_OFFSET = 106;

    /// @dev Scales baseWeights up/down so that resulting weights array is normalized.
    /// @param _baseWeights Array with weights of tokens. Those that are non-zero need to be scaled.
    /// @param _fixedWeights Array with weights of tokens. Those that are non-zero are fixed.
    /// @return Array with scaled and fixed weights of tokens. Should add up to one.
    function normalizeInterpolated(uint256[] memory _baseWeights, uint256[] memory _fixedWeights)
        external
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
        external
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

    function assembleReindexParams(
        IERC20[] memory tokens,
        uint256[] memory desiredWeights,
        uint256[] memory minimumBalances,
        mapping(IERC20 => bytes32) storage tokenState,
        mapping(IERC20 => uint256) storage minBalances
    )
        external
        returns (
            uint256[] memory fixedWeights,
            uint256[] memory newTokenTargetWeights,
            IERC20[] memory existingTokens,
            IERC20[] memory newTokens
        )
    {
        /*
            assemble params for IndexPoolUtils._normalizeInterpolated:
        */

        // the weights that are fixed and that the other tokens need to be adjusted by
        fixedWeights = new uint256[](tokens.length);
        // we need to store the final desired weight of a new tokensince initially it will be set to 1%
        newTokenTargetWeights = new uint256[](tokens.length);

        existingTokens = new IERC20[](tokens.length);

        /*
            this is some mambojambo to get an array that only contains the
            addresses of the new tokens
        */
        IERC20[] memory newTokensContainer = new IERC20[](tokens.length);
        uint8 newTokenCounter;

        for (uint8 i = 0; i < tokens.length; i++) {
            _require(minimumBalances[i] != 0, Errors.INVALID_ZERO_MINIMUM_BALANCE);
            bytes32 currentTokenState = tokenState[IERC20(tokens[i])];

            // // check if token is new token by checking if no startTime is set
            if (currentTokenState.decodeUint64(_START_WEIGHT_OFFSET) == 0) {
                // currentToken is new token
                // add to fixedWeights (memory)
                fixedWeights[i] = _INITIAL_WEIGHT;
                // mark token to be new to allow for additional logic in _startGradualWeightChange (for gas savings)
                newTokenTargetWeights[i] = desiredWeights[i];
                // store minimumBalance (state) also serves as initialization flag
                minBalances[tokens[i]] = minimumBalances[i];
                // add new token to container to be stored further down
                newTokensContainer[newTokenCounter] = tokens[i];
                // increment counter for new tokens (memory)
                newTokenCounter++;
            } else {
                // currentToken is existing (not new) token
                existingTokens[i] = tokens[i];
            }
        }

        newTokens = new IERC20[](newTokenCounter);

        for (uint8 i = 0; i < newTokenCounter; i++) {
            newTokens[i] = newTokensContainer[i];
        }
    }

    /// @dev When token becomes initialized its weight is immediately adjusted relative to the amount by
    /// which its balance axceeds its minBalance
    /// @param _balanceIn Amount of uninitialized token in pool (before the swap)
    /// @param _minimumBalance Minimum balance set for the uninitialized token (= initialization threshold)
    /// @param _amount Minimum balance set for the uninitialized token (= initialization threshold)
    /// @return Weight to which will be the start weight of the next weight update for initialized token.
    function getAdjustedNewStartWeight(
        uint256 _balanceIn,
        uint256 _minimumBalance,
        uint256 _amount
    ) internal pure returns (uint256) {
        return
            FixedPoint.divDown(
                FixedPoint.mulDown(FixedPoint.add(_balanceIn, _amount), _UNINITIALIZED_WEIGHT),
                _minimumBalance
            );
    }
}
