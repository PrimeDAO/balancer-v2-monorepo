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

/**
 * @dev Basic Weighted Pool with immutable weights.
 */
contract IndexedPool is BaseWeightedPool {
    using FixedPoint for uint256;

    uint256 private constant _MAX_TOKENS = 50;

    uint256 private immutable _totalTokens;

    IERC20[] internal _tokens;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    uint256[] internal _scalingFactors;

    // The protocol fees will always be charged using the token associated with the max weight in the pool.
    // Since these Pools will register tokens only once, we can assume this index will be constant.
    uint256 internal immutable _maxWeightTokenIndex;

    uint256 internal immutable _normalizedWeight0;
    uint256 internal immutable _normalizedWeight1;
    uint256 internal immutable _normalizedWeight2;
    uint256 internal immutable _normalizedWeight3;
    uint256 internal immutable _normalizedWeight4;
    uint256 internal immutable _normalizedWeight5;
    uint256 internal immutable _normalizedWeight6;
    uint256 internal immutable _normalizedWeight7;
    uint256 internal immutable _normalizedWeight8;
    uint256 internal immutable _normalizedWeight9;
    uint256 internal immutable _normalizedWeight10;
    uint256 internal immutable _normalizedWeight11;
    uint256 internal immutable _normalizedWeight12;
    uint256 internal immutable _normalizedWeight13;
    uint256 internal immutable _normalizedWeight14;
    uint256 internal immutable _normalizedWeight15;
    uint256 internal immutable _normalizedWeight16;
    uint256 internal immutable _normalizedWeight17;
    uint256 internal immutable _normalizedWeight18;
    uint256 internal immutable _normalizedWeight19;

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

        _normalizedWeight0 = normalizedWeights[0];
        _normalizedWeight1 = normalizedWeights[1];
        _normalizedWeight2 = numTokens > 2 ? normalizedWeights[2] : 0;
        _normalizedWeight3 = numTokens > 3 ? normalizedWeights[3] : 0;
        _normalizedWeight4 = numTokens > 4 ? normalizedWeights[4] : 0;
        _normalizedWeight5 = numTokens > 5 ? normalizedWeights[5] : 0;
        _normalizedWeight6 = numTokens > 6 ? normalizedWeights[6] : 0;
        _normalizedWeight7 = numTokens > 7 ? normalizedWeights[7] : 0;
        _normalizedWeight8 = numTokens > 8 ? normalizedWeights[8] : 0;
        _normalizedWeight9 = numTokens > 9 ? normalizedWeights[9] : 0;
        _normalizedWeight10 = numTokens > 10 ? normalizedWeights[10] : 0;
        _normalizedWeight11 = numTokens > 11 ? normalizedWeights[11] : 0;
        _normalizedWeight12 = numTokens > 12 ? normalizedWeights[12] : 0;
        _normalizedWeight13 = numTokens > 13 ? normalizedWeights[13] : 0;
        _normalizedWeight14 = numTokens > 14 ? normalizedWeights[14] : 0;
        _normalizedWeight15 = numTokens > 15 ? normalizedWeights[15] : 0;
        _normalizedWeight16 = numTokens > 16 ? normalizedWeights[16] : 0;
        _normalizedWeight17 = numTokens > 17 ? normalizedWeights[17] : 0;
        _normalizedWeight18 = numTokens > 18 ? normalizedWeights[18] : 0;
        _normalizedWeight19 = numTokens > 19 ? normalizedWeights[19] : 0;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _tokens = tokens;

        for(uint i = 0; i < numTokens; i++){
            _scalingFactors.push(_computeScalingFactor(tokens[i]););
        }
    }

    function _getNormalizedWeight(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        for(uint i = 0; i < _tokens.length; i++){
            if (token == _tokens[i]) {
                return _normalizedWeight0;
            }
        }
        _revert(Errors.INVALID_TOKEN);
    }

    function _getNormalizedWeights() internal view virtual override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](totalTokens);

        // prettier-ignore
        {
            if (totalTokens > 0) { normalizedWeights[0] = _normalizedWeight0; } else { return normalizedWeights; }
            if (totalTokens > 1) { normalizedWeights[1] = _normalizedWeight1; } else { return normalizedWeights; }
            if (totalTokens > 2) { normalizedWeights[2] = _normalizedWeight2; } else { return normalizedWeights; }
            if (totalTokens > 3) { normalizedWeights[3] = _normalizedWeight3; } else { return normalizedWeights; }
            if (totalTokens > 4) { normalizedWeights[4] = _normalizedWeight4; } else { return normalizedWeights; }
            if (totalTokens > 5) { normalizedWeights[5] = _normalizedWeight5; } else { return normalizedWeights; }
            if (totalTokens > 6) { normalizedWeights[6] = _normalizedWeight6; } else { return normalizedWeights; }
            if (totalTokens > 7) { normalizedWeights[7] = _normalizedWeight7; } else { return normalizedWeights; }
            if (totalTokens > 8) { normalizedWeights[8] = _normalizedWeight8; } else { return normalizedWeights; }
            if (totalTokens > 9) { normalizedWeights[9] = _normalizedWeight9; } else { return normalizedWeights; }
            if (totalTokens > 10) { normalizedWeights[10] = _normalizedWeight10; } else { return normalizedWeights; }
            if (totalTokens > 11) { normalizedWeights[11] = _normalizedWeight11; } else { return normalizedWeights; }
            if (totalTokens > 12) { normalizedWeights[12] = _normalizedWeight12; } else { return normalizedWeights; }
            if (totalTokens > 13) { normalizedWeights[13] = _normalizedWeight13; } else { return normalizedWeights; }
            if (totalTokens > 14) { normalizedWeights[14] = _normalizedWeight14; } else { return normalizedWeights; }
            if (totalTokens > 15) { normalizedWeights[15] = _normalizedWeight15; } else { return normalizedWeights; }
            if (totalTokens > 16) { normalizedWeights[16] = _normalizedWeight16; } else { return normalizedWeights; }
            if (totalTokens > 17) { normalizedWeights[17] = _normalizedWeight17; } else { return normalizedWeights; }
            if (totalTokens > 18) { normalizedWeights[18] = _normalizedWeight18; } else { return normalizedWeights; }
            if (totalTokens > 19) { normalizedWeights[19] = _normalizedWeight19; } else { return normalizedWeights; }
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
                return _scalingFactor[i];
            }
        }

        _revert(Errors.INVALID_TOKEN);

    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        return _scalingFactors;
    }
}
