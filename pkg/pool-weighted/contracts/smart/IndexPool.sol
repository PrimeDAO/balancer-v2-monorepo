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

/**
 * @dev Basic Weighted Pool with immutable weights.
 */
contract IndexPool is BaseWeightedPool, ReentrancyGuard {
    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;

    uint256 private constant _MAX_TOKENS = 50;

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
    // [ 155 bits|   5 bits |  32 bits   |   64 bits    ]
    // [ unused  | decimals | end weight | start weight ]
    // |MSB                                          LSB|
    mapping(IERC20 => bytes32) private _tokenState;

    // Offsets for data elements in _tokenState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 96;

    uint256 private constant _SECONDS_IN_A_DAY = 86400;

    IERC20[] internal _tokens;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    // solhint-disable-next-line
    uint256[] internal scalingFactors;

    // The protocol fees will always be charged using the token associated with the max weight in the pool.
    // Since these Pools will register tokens only once, we can assume this index will be constant.
    uint256 internal immutable _maxWeightTokenIndex;

    uint256[] internal _normalizedWeights;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BaseWeightedPool(
            vault,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, normalizedWeights.length);

        _setMiscData(_getMiscData().insertUint7(numTokens, _TOTAL_TOKENS_OFFSET));
        // Double check it fits in 7 bits
        _require(_getTotalTokens() == numTokens, Errors.MAX_TOKENS);

        // Ensure  each normalized weight is above them minimum and find the token index of the maximum weight
        uint256 normalizedSum = 0;
        uint256 maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            uint256 normalizedWeight = normalizedWeights[i];
            _require(normalizedWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            normalizedSum = normalizedSum.add(normalizedWeight);
            if (normalizedWeight > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeight;
            }
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _maxWeightTokenIndex = maxWeightTokenIndex;

        _normalizedWeights = normalizedWeights;
        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _tokens = tokens;

        for (uint8 i = 0; i < numTokens; i++) {
            scalingFactors.push(_computeScalingFactor(tokens[i]));
        }

        uint256 currentTime = block.timestamp;
        _startGradualWeightChange(currentTime, currentTime, normalizedWeights, normalizedWeights, tokens);
    }

    /**
     * @dev Return start time, end time, and endWeights as an array.
     * Current weights should be retrieved via `getNormalizedWeights()`.
     */
    function getGradualWeightUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory endWeights
        )
    {
        // Load current pool state from storage
        bytes32 poolState = _getMiscData();

        startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 totalTokens = tokens.length;

        endWeights = new uint256[](totalTokens);

        for (uint256 i = 0; i < totalTokens; i++) {
            endWeights[i] = _tokenState[_tokens[i]].decodeUint32(_END_WEIGHT_OFFSET).uncompress32();
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
        IERC20[] memory tokens
    ) internal virtual {
        uint256 normalizedSum = 0;
        bytes32 tokenState;

        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            IERC20 token = tokens[i];

            _tokenState[token] = tokenState
                .insertUint64(startWeights[i].compress64(), _START_WEIGHT_OFFSET)
                .insertUint32(endWeight.compress32(), _END_WEIGHT_OFFSET)
                .insertUint5(uint256(18).sub(ERC20(address(token)).decimals()), _DECIMAL_DIFF_OFFSET);

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

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights, tokens);
    }

    function reweighTokens(address[] calldata tokens, uint256[] calldata desiredWeights) public {
        uint256 endTime = _getMiscData().decodeUint32(_END_TIME_OFFSET);
        require(block.timestamp >= endTime, "Weight change is already in process");
        uint256 diff = 0;
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, desiredWeights.length);

        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            if (desiredWeights[i] > _normalizedWeights[i]) {
                if (diff < desiredWeights[i].sub(_normalizedWeights[i])) {
                    diff = desiredWeights[i].sub(_normalizedWeights[i]);
                }
            } else {
                if (diff < _normalizedWeights[i].sub(desiredWeights[i])) {
                    diff = _normalizedWeights[i].sub(desiredWeights[i]);
                }
            }
            normalizedSum = normalizedSum.add(desiredWeights[i]);
        }
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);
        uint256 changeTime = ((diff.mulDown(_SECONDS_IN_A_DAY)).divDown(FixedPoint.ONE)) * 100;
        _updateWeightsGradually(block.timestamp, block.timestamp.add(changeTime), desiredWeights);
    }

    function reindexTokens(
        address[] calldata tokens,
        uint256[] calldata desiredWeights,
        uint256[] calldata minimumBalances
    ) external {
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, desiredWeights.length, minimumBalances.length);

        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            require(minimumBalances[i] != 0, "Invalid zero minimum balance");
            normalizedSum = normalizedSum.add(desiredWeights[i]);
        }
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);
    }

    function _interpolateWeight(bytes32 tokenData, uint256 pctProgress) private pure returns (uint256 finalWeight) {
        uint256 startWeight = tokenData.decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
        uint256 endWeight = tokenData.decodeUint32(_END_WEIGHT_OFFSET).uncompress32();

        if (pctProgress == 0 || startWeight == endWeight) return startWeight;
        if (pctProgress >= FixedPoint.ONE) return endWeight;

        if (startWeight > endWeight) {
            uint256 weightDelta = pctProgress.mulDown(startWeight - endWeight);
            return startWeight - weightDelta;
        } else {
            uint256 weightDelta = pctProgress.mulDown(endWeight - startWeight);
            return startWeight + weightDelta;
        }
    }

    function _getNormalizedWeight(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        for(uint i = 0; i < _tokens.length; i++){
            if (token == _tokens[i]) {
                return _normalizedWeights[i];
            }
        }
        _revert(Errors.INVALID_TOKEN);
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

    /**
     * @dev Returns the scaling factor for one of the Pool's tokens. Reverts if `token` is not a token registered by the
     * Pool.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        for(uint i = 0; i < _tokens.length; i++){
            if (token == _tokens[i]) {
                return scalingFactors[i];
            }
        }

        _revert(Errors.INVALID_TOKEN);
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        return scalingFactors;
    }
}
