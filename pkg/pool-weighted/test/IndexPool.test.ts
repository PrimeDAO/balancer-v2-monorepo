import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MINUTE, advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { range } from 'lodash';
import { WeightedPoolType } from '../../../pvt/helpers/src/models/pools/weighted/types';

describe('IndexPool', function () {
  let owner: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, owner, other] = await ethers.getSigners();
  });

  const MAX_TOKENS = 4;

  let allTokens: TokenList, tokens: TokenList;

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(MAX_TOKENS + 1, { sorted: true });
    tokens = allTokens.subset(4);
    await tokens.mint({ to: [other], amount: fp(200) });
  });

  let sender: SignerWithAddress;
  let pool: WeightedPool;
  const weights = [fp(0.3), fp(0.55), fp(0.1), fp(0.05)];
  const initialBalances = [fp(0.9), fp(1.8), fp(2.7), fp(3.6)];

  context('with invalid creation parameters', () => {
    const tooManyWeights = [fp(0.3), fp(0.25), fp(0.3), fp(0.1), fp(0.05)];

    it('fails with < 2 tokens', async () => {
      const params = {
        tokens: allTokens.subset(1),
        weights: [fp(0.3)],
        owner,
        poolType: WeightedPoolType.INDEX_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MIN_TOKENS');
    });

    it('fails with mismatched tokens/weights', async () => {
      const params = {
        tokens,
        weights: tooManyWeights,
        owner,
        poolType: WeightedPoolType.INDEX_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  describe('weights and scaling factors', () => {
    for (const numTokens of range(2, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let pool: WeightedPool;
        let tokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          tokens = allTokens.subset(numTokens);

          pool = await WeightedPool.create({
            poolType: WeightedPoolType.INDEX_POOL,
            tokens,
            weights: weights.slice(0, numTokens),
          });
        });

        it('sets token weights', async () => {
          const normalizedWeights = await pool.getNormalizedWeights();
          console.log(normalizedWeights);

          for (let i = 0; i < numTokens; i++) {
            expect(normalizedWeights[i]).to.equalWithError(pool.normalizedWeights[i], 0.0001);
          }
        });

        it('sets scaling factors', async () => {
          const poolScalingFactors = await pool.getScalingFactors();
          const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

          expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
        });
      });
    }
  });

  context('when deployed from factory', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens,
        weights,
        owner,
        poolType: WeightedPoolType.INDEX_POOL,
        fromFactory: true,
      };
      pool = await WeightedPool.create(params);
    });

    it('has no asset managers', async () => {
      await tokens.asyncEach(async (token) => {
        const { assetManager } = await pool.getTokenInfo(token);
        expect(assetManager).to.be.zeroAddress;
      });
    });
  });

  describe('with valid creation parameters', () => {
    context('when initialized with swaps disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens,
          weights,
          owner,
          poolType: WeightedPoolType.INDEX_POOL,
          swapEnabledOnStart: false,
        };
        pool = await WeightedPool.create(params);
      });

      it('swaps are blocked', async () => {
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.be.revertedWith('MAX_IN_RATIO');
      });
    });
  });

  describe('#reweighTokens', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens,
        weights,
        owner,
        poolType: WeightedPoolType.INDEX_POOL,
        swapEnabledOnStart: false,
      };
      pool = await WeightedPool.create(params);
    });

    context('when input array lengths differ', () => {
      it('reverts: "INPUT_LENGTH_MISMATCH"', async () => {
        const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
        const twoWeights = [fp(0.5), fp(0.5)];

        await expect(pool.reweighTokens(threeAddresses, twoWeights)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
      });
    });

    context('when weights are not normalized', () => {
      it('reverts: "INPUT_LENGTH_MISMATCH"', async () => {
        const addresses = allTokens.subset(2).tokens.map((token) => token.address);
        const denormalizedWeights = [fp(0.5), fp(0.3)];

        await expect(pool.reweighTokens(addresses, denormalizedWeights)).to.be.revertedWith(
          'NORMALIZED_WEIGHT_INVARIANT'
        );
      });
    });
  });

  describe('#reindexTokens', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens,
        weights,
        owner,
        poolType: WeightedPoolType.INDEX_POOL,
        swapEnabledOnStart: false,
      };
      pool = await WeightedPool.create(params);
    });

    context('when input array lengths differ', () => {
      it('reverts "INPUT_LENGTH_MISMATCH" if lengths of tokens and weights differ', async () => {
        const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
        const twoWeights = [fp(0.5), fp(0.5)];
        const threeMinimumBalances = [1000, 2000, 3000];

        await expect(pool.reindexTokens(threeAddresses, twoWeights, threeMinimumBalances)).to.be.revertedWith(
          'INPUT_LENGTH_MISMATCH'
        );
      });

      it('reverts "INPUT_LENGTH_MISMATCH" if lengths of tokens and minimum balances differ', async () => {
        const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
        const threeWeights = [fp(0.4), fp(0.5), fp(0.1)];
        const twoMinimumBalances = [1000, 2000];

        await expect(pool.reindexTokens(threeAddresses, threeWeights, twoMinimumBalances)).to.be.revertedWith(
          'INPUT_LENGTH_MISMATCH'
        );
      });

      it('reverts "INPUT_LENGTH_MISMATCH" if lengths of weights and minimum balances differ', async () => {
        const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
        const twoWeights = [fp(0.5), fp(0.5)];
        const threeMinimumBalances = [1000, 2000, 3000];

        await expect(pool.reindexTokens(threeAddresses, twoWeights, threeMinimumBalances)).to.be.revertedWith(
          'INPUT_LENGTH_MISMATCH'
        );
      });
    });

    context('when weights are not normalized', () => {
      it('reverts: "NORMALIZED_WEIGHT_INVARIANT"', async () => {
        const addresses = allTokens.subset(2).tokens.map((token) => token.address);
        const denormalizedWeights = [fp(0.5), fp(0.3)];
        const minimumBalances = [1000, 2000];

        await expect(pool.reindexTokens(addresses, denormalizedWeights, minimumBalances)).to.be.revertedWith(
          'NORMALIZED_WEIGHT_INVARIANT'
        );
      });
    });

    context('when a minimum balance is zero', () => {
      it('reverts: "INVALID_ZERO_MINIMUM_BALANCE"', async () => {
        const addresses = allTokens.subset(2).tokens.map((token) => token.address);
        const weights = [fp(0.5), fp(0.5)];
        const invalidMinimumBalances = [1000, 0];

        await expect(pool.reindexTokens(addresses, weights, invalidMinimumBalances)).to.be.revertedWith(
          'Invalid zero minimum balance'
        );
      });
    });
  });

  describe('#getGradualWeightUpdateParams', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens,
        weights,
        owner,
        poolType: WeightedPoolType.INDEX_POOL,
        swapEnabledOnStart: false,
      };
      pool = await WeightedPool.create(params);
    });

    context('when input array lengths differ', () => {
      it('reverts: "INPUT_LENGTH_MISMATCH"', async () => {
        const fiveWeights = [fp(0.1), fp(0.3), fp(0.5), fp(0.1)];
        const ret = await pool.reweighTokens(allTokens.subset(4).tokens.map((token) => token.address), fiveWeights);
        console.log(ret);
        let diff = 0;
        for (let i = 0; i < fiveWeights.length; i++) {
          if (Math.abs(Number(fiveWeights[i]) - Number(weights[i])) > diff) {
            diff = Math.abs(Number(fiveWeights[i]) - Number(weights[i]));
          }
        }
        const time = (diff / 1e18) * 86400;
        const { startTime, endTime, endWeights } = await pool.getGradualWeightUpdateParams();
        expect(time).to.equal(Number(endTime) - Number(startTime));
      });
    });
  });
});

