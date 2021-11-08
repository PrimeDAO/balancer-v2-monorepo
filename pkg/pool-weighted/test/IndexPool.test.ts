import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { range } from 'lodash';
import { WeightedPoolType } from '../../../pvt/helpers/src/models/pools/weighted/types';

const calculateMaxWeightDifference = (oldWeights: BigNumber[], newWeights: BigNumber[]) => {
  let maxWeightDifference = 0;
  for (let i = 0; i < newWeights.length; i++) {
    if (Math.abs(Number(newWeights[i]) - Number(oldWeights[i])) > maxWeightDifference) {
      maxWeightDifference = Math.abs(Number(newWeights[i]) - Number(oldWeights[i]));
    }
  }
  return maxWeightDifference;
};

const getTimeForWeightChange = (weightDifference: number) => {
  // 1e18 is 100%, we need to calculate on how much percent the weight changes first,
  // then we can understand how much time do we need by multiplying amount of percents o amount of seconds per day
  // (1% change in a day at max rate)
  return (weightDifference / 1e18) * 86400 * 100;
};

describe.only('IndexPool', function () {
  let owner: SignerWithAddress, other: SignerWithAddress, vault: Vault;

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

  let pool: WeightedPool;
  const weights = [fp(0.3), fp(0.55), fp(0.1), fp(0.05)];

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

    context('with valid inputs', () => {
      const desiredWeights = [fp(0.1), fp(0.3), fp(0.5), fp(0.1)];

      sharedBeforeEach('deploy pool', async () => {
        await pool.reweighTokens(
          allTokens.subset(4).tokens.map((token) => token.address),
          desiredWeights
        );
      });

      it('sets the correct endWeights', async () => {
        const { endWeights } = await pool.getGradualWeightUpdateParams();

        expect(endWeights).to.equalWithError(desiredWeights, 0.0001);
      });

      it('sets the correct rebalancing period', async () => {
        const maxWeightDifference = calculateMaxWeightDifference(desiredWeights, weights);
        const time = getTimeForWeightChange(maxWeightDifference);
        const { startTime, endTime } = await pool.getGradualWeightUpdateParams();

        expect(Number(endTime) - Number(startTime)).to.equalWithError(time, 0.0001);
      });
    });
  });

  describe('#reindexTokens', () => {
    describe('input validation', () => {
      sharedBeforeEach('deploy pool', async () => {
        vault = await Vault.create();
        const params = {
          tokens: tokens.subset(3),
          weights: [fp(0.6), fp(0.2), fp(0.2)],
          owner,
          poolType: WeightedPoolType.INDEX_POOL,
          fromFactory: true,
          vault,
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

    context('when adding one new token', () => {
      const numberNewTokens = 1;
      const numberExistingTokens = 3;
      const newTokenTargetWeight = fp(0.1);
      const originalWeights = [fp(0.4), fp(0.3), fp(0.3)];
      const reindexWeights = [fp(0.5), fp(0.2), fp(0.2), newTokenTargetWeight];
      const standardMinimumBalance = 1000;

      const minimumBalances = new Array(numberExistingTokens + numberNewTokens).fill(standardMinimumBalance);

      let reindexTokens: string[], poolId: string;

      sharedBeforeEach('deploy pool', async () => {
        vault = await Vault.create();
        const params = {
          tokens: tokens.subset(numberExistingTokens),
          weights: originalWeights,
          owner,
          poolType: WeightedPoolType.INDEX_POOL,
          fromFactory: true,
          vault,
        };
        pool = await WeightedPool.create(params);
      });

      sharedBeforeEach('call reindexTokens function', async () => {
        reindexTokens = allTokens.subset(numberExistingTokens + numberNewTokens).tokens.map((token) => token.address);
        poolId = await pool.getPoolId();
        await pool.reindexTokens(reindexTokens, reindexWeights, minimumBalances);
      });

      it('adds the new token to the vault registry', async () => {
        const { tokens: tokensFromVault } = await vault.getPoolTokens(poolId);

        expect(tokensFromVault).to.have.members(reindexTokens);
      });

      it('sets the correct startWeights for all four tokens', async () => {
        const expectedStartWeights = [fp(0.396), fp(0.297), fp(0.297), fp(0.01)];
        const { startWeights } = await pool.getGradualWeightUpdateParams();

        expect(startWeights).to.equalWithError(expectedStartWeights, 0.0001);
      });

      it('sets the correct endWeights for all four tokens', async () => {
        const expectedEndWeights = [fp(0.55), fp(0.22), fp(0.22), fp(0.01)];
        const { endWeights } = await pool.getGradualWeightUpdateParams();

        expect(endWeights).to.equalWithError(expectedEndWeights, 0.0001);
      });

      it('sets the correct rebalancing period', async () => {
        const maxWeightDifference = calculateMaxWeightDifference(reindexWeights, [...originalWeights, fp(0)]);
        const time = getTimeForWeightChange(maxWeightDifference);
        const { startTime, endTime } = await pool.getGradualWeightUpdateParams();

        expect(Number(endTime) - Number(startTime)).to.equalWithError(time, 0.0001);
      });

      it('sets the correct minimum balance for the new token', async () => {
        const minimumBalance = await pool.minBalances(reindexTokens[reindexTokens.length - 1]);

        expect(minimumBalance).to.equalWithError(standardMinimumBalance, 0.0001);
      });

      it('does not set a minimum balance for existing tokens', async () => {
        const minBalFirstToken = await pool.minBalances(reindexTokens[0]);
        const minBalSecondToken = await pool.minBalances(reindexTokens[1]);
        const minBalThirdToken = await pool.minBalances(reindexTokens[2]);

        expect(minBalFirstToken).to.equal(0);
        expect(minBalSecondToken).to.equal(0);
        expect(minBalThirdToken).to.equal(0);
      });

      it('stores the final target weight for the new token', async () => {
        const expectedNewTokenTargetWeights = [fp(0), fp(0), fp(0), newTokenTargetWeight];
        const { newTokenTargetWeights } = await pool.getGradualWeightUpdateParams();

        expect(newTokenTargetWeights).to.equalWithError(expectedNewTokenTargetWeights, 0.0001);
      });
    });
  });
});
