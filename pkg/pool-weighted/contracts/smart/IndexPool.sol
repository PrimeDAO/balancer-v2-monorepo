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


    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot"
    // values. Target end weights do not need as much precision.
    // [ 188 bits |     32 bits   |     32 bits     |    3 bits    |     1 bit    ]
    // [  unused  | end timestamp | start timestamp |   not used   | swap enabled ]
    // |MSB                                                         LSB|
    bytes32 private _poolState;

    // Offsets for data elements in _poolState
    uint256 private constant _SWAP_ENABLED_OFFSET = 0;
    uint256 private constant _START_TIME_OFFSET = 4;
    uint256 private constant _END_TIME_OFFSET = 36;

    // Store scaling factor and start/end weights for each token
    // Mapping should be more efficient than trying to compress it further
    // [ 155 bits|   5 bits |  32 bits   |   64 bits    ]
    // [ unused  | decimals | end weight | start weight ]
    // |MSB                                          LSB|
    mapping(IERC20 => bytes32) private _tokenState;

    // Offsets for data elements in _poolState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 96;

    uint256 private constant _SECONDS_IN_A_DAY = 86400;


    uint256 private immutable _totalTokens;

    IERC20[] internal _tokens;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
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

        _totalTokens = numTokens;

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
        _startGradualWeightChange(currentTime, currentTime, normalizedWeights, normalizedWeights);
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
            bytes32 poolState = _poolState;

            startTime = poolState.decodeUint32(_START_TIME_OFFSET);
            endTime = poolState.decodeUint32(_END_TIME_OFFSET);
            uint256 totalTokens = _getTotalTokens();
            endWeights = new uint256[](totalTokens);

            for (uint256 i = 0; i < totalTokens; i++) {
                endWeights[i] =  _tokenState[_tokens[i]].decodeUint32(_END_WEIGHT_OFFSET).uncompress32();
            }
    }

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress(bytes32 poolState) private view returns (uint256) {
        uint256 currentTime = block.timestamp;
        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        uint256 endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        if (currentTime > endTime) {
            return FixedPoint.ONE;
        } else if (currentTime < startTime) {
            return 0;
        }

        // No need for SafeMath as it was checked right above: endTime >= currentTime >= startTime
        uint256 totalSeconds = endTime - startTime;
        uint256 secondsElapsed = currentTime - startTime;

        // In the degenerate case of a zero duration change, consider it completed (and avoid division by zero)
        return totalSeconds == 0 ? FixedPoint.ONE : secondsElapsed.divDown(totalSeconds);
    }

    /**
    * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
    * if necessary.
    */
    function _startGradualWeightChange(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights
    ) internal virtual {
        bytes32 newPoolState = _poolState;

        uint256 normalizedSum = 0;
        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            _tokenState[_tokens[i]] = _tokenState[_tokens[i]]
            .insertUint64(startWeights[i].compress64(), _START_WEIGHT_OFFSET )
            .insertUint32(endWeight.compress32(), _END_WEIGHT_OFFSET)
            .insertUint5(uint256(18).sub(ERC20(address(_tokens[i])).decimals()), _DECIMAL_DIFF_OFFSET);

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = newPoolState.insertUint32(startTime, _START_TIME_OFFSET).insertUint32(endTime, _END_TIME_OFFSET);

        //        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }


    /**
     * @dev Schedule a gradual weight change, from the current weights to the given endWeights,
     * over startTime to endTime
     */
    function updateWeightsGradually(
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

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights);
    }


    function reweighTokens(address[] calldata tokens, uint256[] calldata desiredWeights) public{
        uint256 endTime = _poolState.decodeUint32(_END_TIME_OFFSET);
        require(block.timestamp >= endTime ,"Weight change is already in process");
        uint256 diff = 0;
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, desiredWeights.length);

        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            if(desiredWeights[i] > _normalizedWeights[i]){
                if(diff < desiredWeights[i].sub(_normalizedWeights[i])){
                    diff = desiredWeights[i].sub(_normalizedWeights[i]);
                }
            }
            else {
                if(diff < _normalizedWeights[i].sub(desiredWeights[i])){
                    diff = _normalizedWeights[i].sub(desiredWeights[i]);
                }
            }
            normalizedSum = normalizedSum.add(desiredWeights[i]);
        }
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);
        uint256 change_time = ((diff.mulDown(_SECONDS_IN_A_DAY)).divDown(FixedPoint.ONE)) * 100;
        updateWeightsGradually(block.timestamp, block.timestamp.add(change_time), desiredWeights);
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

    function _interpolateWeight(
        uint256 startWeight,
        uint256 endWeight,
        uint256 pctProgress
    ) private pure returns (uint256) {
        if (pctProgress == 0 || startWeight == endWeight) return startWeight;
        if (pctProgress >= FixedPoint.ONE) return endWeight;

        if (startWeight > endWeight) {
            uint256 weightDelta = pctProgress.mulDown(startWeight - endWeight);
            return startWeight.sub(weightDelta);
        } else {
            uint256 weightDelta = pctProgress.mulDown(endWeight - startWeight);
            return startWeight.add(weightDelta);
        }
    }


    function _getNormalizedWeightByIndex(uint256 i, bytes32 poolState) internal view returns (uint256) {
        uint256 startWeight =  _tokenState[_tokens[i]].decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
        uint256 endWeight =  _tokenState[_tokens[i]].decodeUint32(_END_WEIGHT_OFFSET).uncompress32();

        uint256 pctProgress = _calculateWeightChangeProgress(poolState);

        return _interpolateWeight(startWeight, endWeight, pctProgress);
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


    function _getNormalizedWeights() internal view override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](totalTokens);

        bytes32 poolState = _poolState;

        for( uint8 i = 0; i < totalTokens; i++)
        {
            normalizedWeights[i] = _getNormalizedWeightByIndex(i, poolState);
        }

        return normalizedWeights;
    }


    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        virtual
        override
        returns (uint256[] memory, uint256)
    {
        return (_getNormalizedWeights(), _maxWeightTokenIndex);
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return _MAX_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
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
