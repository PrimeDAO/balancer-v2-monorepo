// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../BaseWeightedPool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "./WeightCompression.sol";
import "../utils/IndexPoolUtils.sol";

/**
 * @dev Basic Weighted Pool with immutable weights.
 */
contract IndexPool is BaseWeightedPool, ReentrancyGuard {
    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;

    uint256 private constant _MAX_TOKENS = 50;
    uint256 private constant _INITIAL_WEIGHT = 10**16;

    // Use the _miscData slot in BasePool
    // First 64 bits are reserved for the swap fee
    //
    // Store non-token-based values:
    // Start/end timestamps for gradual weight update
    // Cache total tokens
    // [ 64 bits  |  120 bits |  32 bits  |   32 bits  |    7 bits    |    1 bit     ]
    // [ reserved |  unused   | end time  | start time | total tokens |   swap flag  ]
    // |MSB                                                                       LSB|
    uint256 private constant _SWAP_ENABLED_OFFSET = 0;
    uint256 private constant _TOTAL_TOKENS_OFFSET = 1;
    uint256 private constant _START_TIME_OFFSET = 8;
    uint256 private constant _END_TIME_OFFSET = 40;

    // Store scaling factor and start/end weights for each token
    // Mapping should be more efficient than trying to compress it further
    // [ 123 bits| 32 bits        |   5 bits |  32 bits   |   64 bits    ]
    // [ unused  | target weights | decimals | end weight | start weight ]
    // |MSB                                          LSB|
    mapping(IERC20 => bytes32) private _tokenState;

    // minimum balances that represent initialization threshold for new tokens
    mapping(IERC20 => uint256) public minBalances;

    // Offsets for data elements in _tokenState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 96;
    uint256 private constant _UNINITIALIZED_OFFSET = 101;
    uint256 private constant _NEW_TOKEN_TARGET_WEIGHT_OFFSET = 106;

    uint256 private constant _SECONDS_IN_A_DAY = 86400;

    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
    }

    constructor(NewPoolParams memory params)
        BaseWeightedPool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            new address[](params.tokens.length),
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        uint256 numTokens = params.tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, params.normalizedWeights.length);

        _setMiscData(_getMiscData().insertUint7(numTokens, _TOTAL_TOKENS_OFFSET));
        // Double check it fits in 7 bits
        _require(_getTotalTokens() == numTokens, Errors.MAX_TOKENS);
        uint256 currentTime = block.timestamp;
        _startGradualWeightChange(
            currentTime,
            currentTime,
            params.normalizedWeights,
            params.normalizedWeights,
            params.tokens,
            new uint256[](params.tokens.length)
        );
    }

    /**
     * @dev Return start time, end time, startWeights, endWeights and the final target wights of new tokens as an array.
     * Current weights should be retrieved via `getNormalizedWeights()`.
     */
    function getGradualWeightUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory endWeights,
            uint256[] memory startWeights,
            uint256[] memory newTokenTargetWeights
        )
    {
        // Load current pool state from storage
        bytes32 poolState = _getMiscData();

        startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 totalTokens = tokens.length;

        endWeights = new uint256[](totalTokens);
        startWeights = new uint256[](totalTokens);
        newTokenTargetWeights = new uint256[](totalTokens);

        for (uint256 i = 0; i < totalTokens; i++) {
            bytes32 tokenState = _tokenState[tokens[i]];
            endWeights[i] = tokenState.decodeUint32(_END_WEIGHT_OFFSET).uncompress32();
            startWeights[i] = tokenState.decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
            newTokenTargetWeights[i] = tokenState.decodeUint32(_NEW_TOKEN_TARGET_WEIGHT_OFFSET).uncompress32();
        }
    }

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress() private view returns (uint256) {
        uint256 currentTime = block.timestamp;
        bytes32 poolState = _getMiscData();

        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        uint256 endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        if (currentTime >= endTime) {
            return FixedPoint.ONE;
        } else if (currentTime <= startTime) {
            return 0;
        }

        uint256 totalSeconds = endTime - startTime;
        uint256 secondsElapsed = currentTime - startTime;

        // In the degenerate case of a zero duration change, consider it completed (and avoid division by zero)
        return secondsElapsed.divDown(totalSeconds);
    }

    /**
     * @dev When calling _updateWeightsGradually again during an update,
     * reset the start weights to the current weights, if necessary.
     */
    function _startGradualWeightChange(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights,
        IERC20[] memory tokens,
        uint256[] memory newTokenTargetWeights
    ) internal virtual {
        uint256 normalizedSum = 0;
        bytes32 tokenState;
        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);
            tokenState = tokenState
                .insertUint64(startWeights[i].compress64(), _START_WEIGHT_OFFSET)
                .insertUint32(endWeight.compress32(), _END_WEIGHT_OFFSET)
                .insertUint5(uint256(18).sub(ERC20(address(tokens[i])).decimals()), _DECIMAL_DIFF_OFFSET);

            // setting the final target weight here allowss us to save gas by writing to storage only once per token
            if (newTokenTargetWeights[i] != 0) {
                tokenState = tokenState.insertUint32(
                    newTokenTargetWeights[i].compress32(),
                    _NEW_TOKEN_TARGET_WEIGHT_OFFSET
                );
            }

            // write new token state to storage
            _tokenState[IERC20(tokens[i])] = tokenState;

            normalizedSum = normalizedSum.add(endWeight);
        }

        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _setMiscData(
            _getMiscData().insertUint32(startTime, _START_TIME_OFFSET).insertUint32(endTime, _END_TIME_OFFSET)
        );
        //        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    /**
     * @dev Schedule a gradual weight change, from the current weights to the given endWeights,
     * over startTime to endTime
     */
    function _updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) internal nonReentrant {
        InputHelpers.ensureInputLengthMatch(_getTotalTokens(), endWeights.length);

        // If the start time is in the past, "fast forward" to start now
        // This avoids discontinuities in the weight curve. Otherwise, if you set the start/end times with
        // only 10% of the period in the future, the weights would immediately jump 90%
        uint256 currentTime = block.timestamp;
        startTime = Math.max(currentTime, startTime);

        _require(startTime <= endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        _startGradualWeightChange(
            startTime,
            endTime,
            _getNormalizedWeights(),
            endWeights,
            tokens,
            new uint256[](tokens.length)
        );
    }

    function reweighTokens(IERC20[] calldata tokens, uint256[] calldata desiredWeights) public {
        uint256 endTime = _getMiscData().decodeUint32(_END_TIME_OFFSET);
        require(block.timestamp >= endTime, "Weight change is already in process");
        InputHelpers.ensureInputLengthMatch(tokens.length, desiredWeights.length);
        uint256 changeTime = _calcReweighTime(tokens, desiredWeights);
        _updateWeightsGradually(block.timestamp, block.timestamp.add(changeTime), desiredWeights);
    }

    function reindexTokens(
        IERC20[] memory tokens,
        uint256[] memory desiredWeights,
        uint256[] memory minimumBalances
    ) external {
        InputHelpers.ensureInputLengthMatch(tokens.length, desiredWeights.length, minimumBalances.length);

        /*
            assemble params for IndexPoolUtils._normalizeInterpolated:
        */
        // the initial weights in the pool (here a new token has a weight of zero)
        uint256[] memory baseWeights = new uint256[](tokens.length);
        // the weights that are fixed and that the other tokens need to be adjusted by
        uint256[] memory fixedWeights = new uint256[](tokens.length);
        // we need to store the final desired weight of a new tokensince initially it will be set to 1%
        uint256[] memory newTokenTargetWeights = new uint256[](tokens.length);

        /*
            this is some mambojambo to get an array that only contains the
            addresses of the new tokens
        */
        IERC20[] memory newTokensContainer = new IERC20[](tokens.length);
        uint8 newTokenCounter = 0;

        for (uint8 i = 0; i < tokens.length; i++) {
            require(minimumBalances[i] != 0, "Invalid zero minimum balance");
            bytes32 currentTokenState = _tokenState[IERC20(tokens[i])];

            // check if token is new token by checking if no startTime is set
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
                baseWeights[i] = _getNormalizedWeight(IERC20(tokens[i]));
            }
        }
        _registerNewTokensWithVault(newTokensContainer, newTokenCounter);
        //setting the initial
        _startGradualWeightChange(
            block.timestamp,
            // !! here we make a simplifaction by calculating the time based
            // just looking at the initial startWeights vs finalEndweights
            block.timestamp + _calcReweighTime(tokens, desiredWeights),
            // here we get the starting weights for the new weight change, that should be the weights
            // as applicable immediately after the first weight change
            // e.g. 49.5/49.5/1 after a tokens has been added to a 50/50 pool
            IndexPoolUtils.normalizeInterpolated(baseWeights, fixedWeights),
            // TODO: here we will need the endWeights as long as they apply until the new token becomes initialized
            // e.g. 45/45/10 after new token becomes initialized and aims for fina target weight of 10%
            IndexPoolUtils.normalizeInterpolated(desiredWeights, fixedWeights),
            tokens,
            newTokenTargetWeights
        );
    }

    /// @dev Hook is called when someone swaps through vault.
    /// @param swapRequest Swap params.
    /// @param currentBalanceTokenIn Vault balance of token that is swapped into the pool.
    /// @param currentBalanceTokenOut Vault balance of token that is swapped out of the pool.
    /// @return Amount of tokens that the user will receive in return for their token.
    function onSwap(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) public override returns (uint256) {
        //cannot swap out uninitialized token
        require(minBalances[swapRequest.tokenOut] == 0, "Uninitialized token");

        return super.onSwap(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    /// @dev Calculates the time horizon for a rebasing based on max weight change.
    /// @param tokens Array with addresses of tokens.
    /// @param desiredWeights Array with desired weights of tokens. Must be in same order.
    /// @return changeTime Time horizon for the rebalancing period
    function _calcReweighTime(IERC20[] memory tokens, uint256[] memory desiredWeights)
        internal
        view
        returns (uint256 changeTime)
    {
        uint256 diff = 0;
        uint256 numTokens = tokens.length;

        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            uint256 normalizedWeight = _getNormalizedWeight(IERC20(tokens[i]));

            if (desiredWeights[i] > normalizedWeight) {
                if (diff < desiredWeights[i].sub(normalizedWeight)) {
                    diff = desiredWeights[i].sub(normalizedWeight);
                }
            } else {
                if (diff < normalizedWeight.sub(desiredWeights[i])) {
                    diff = normalizedWeight.sub(desiredWeights[i]);
                }
            }
            normalizedSum = normalizedSum.add(desiredWeights[i]);
        }

        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);
        changeTime = ((diff.mulDown(_SECONDS_IN_A_DAY)).divDown(FixedPoint.ONE)) * 100;
    }

    function _registerNewTokensWithVault(IERC20[] memory newTokensContainer, uint8 amountNewTokens) internal {
        IERC20[] memory newTokens = new IERC20[](amountNewTokens);

        for (uint8 i = 0; i < amountNewTokens; i++) {
            newTokens[i] = newTokensContainer[i];
        }
        getVault().registerTokens(getPoolId(), newTokens, new address[](newTokens.length));
    }

    function _interpolateWeight(bytes32 tokenData, uint256 pctProgress) private pure returns (uint256 finalWeight) {
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

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        uint256 pctProgress = _calculateWeightChangeProgress();
        bytes32 tokenData = _getTokenData(token);

        return _interpolateWeight(tokenData, pctProgress);
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory normalizedWeights) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        normalizedWeights = new uint256[](numTokens);

        uint256 pctProgress = _calculateWeightChangeProgress();

        for (uint256 i = 0; i < numTokens; i++) {
            bytes32 tokenData = _tokenState[tokens[i]];

            normalizedWeights[i] = _interpolateWeight(tokenData, pctProgress);
        }
    }

    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        override
        returns (uint256[] memory normalizedWeights, uint256 maxWeightTokenIndex)
    {
        normalizedWeights = _getNormalizedWeights();

        maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = normalizedWeights[0];

        for (uint256 i = 1; i < normalizedWeights.length; i++) {
            if (normalizedWeights[i] > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeights[i];
            }
        }
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return _MAX_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _getMiscData().decodeUint7(_TOTAL_TOKENS_OFFSET);
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return _readScalingFactor(_getTokenData(token));
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        scalingFactors = new uint256[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = _readScalingFactor(_tokenState[tokens[i]]);
        }
    }

    function _getTokenData(IERC20 token) private view returns (bytes32 tokenData) {
        tokenData = _tokenState[token];
    }

    function _readScalingFactor(bytes32 tokenState) private pure returns (uint256) {
        uint256 decimalsDifference = tokenState.decodeUint5(_DECIMAL_DIFF_OFFSET);

        return FixedPoint.ONE * 10**decimalsDifference;
    }
}
