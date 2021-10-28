import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from '@ethersproject/contracts';

const HUNDRED_PERCENT = BigNumber.from(10).pow(18);

const areClose = (a: BigNumber, b: BigNumber): boolean => {
  return a.sub(b).abs().lte(1);
};

const isNormalized = (weights: BigNumber[]): boolean => {
  const totalWeight = weights.reduce((acc, curr) => acc.add(curr), BigNumber.from(0));
  return totalWeight.eq(HUNDRED_PERCENT);
};

const toBnPercentage = (decimalPercentage: number): BigNumber => {
  const normalizedWeight = decimalPercentage * 10e17;
  return BigNumber.from(normalizedWeight.toString());
};

const percentage = (a: BigNumber, b: BigNumber): BigNumber => a.mul(HUNDRED_PERCENT).div(b);

const getExpectedWeights = (baseWeightsNumbers: number[], fixWeightsNumbers: number[]): BigNumber[] => {
  const baseWeights = baseWeightsNumbers.map((w) => toBnPercentage(w));
  const fixWeights = fixWeightsNumbers.map((w) => toBnPercentage(w));

  let totalDenormalizedBaseWeight = BigNumber.from(0);
  let totalDenormalizedFixedWeight = BigNumber.from(0);

  for (let i = 0; i < baseWeights.length; i++) {
    totalDenormalizedFixedWeight = totalDenormalizedFixedWeight.add(fixWeights[i]);
    if (fixWeights[i].isZero()) {
      totalDenormalizedBaseWeight = totalDenormalizedBaseWeight.add(baseWeights[i]);
    }
  }

  const delta = HUNDRED_PERCENT.sub(totalDenormalizedBaseWeight).sub(totalDenormalizedFixedWeight).abs();

  const finalWeights = baseWeights.map((initialBaseWeight: BigNumber, idx: number) => {
    if (!fixWeights[idx].isZero()) return fixWeights[idx];

    const adjustedBaseWeight = totalDenormalizedBaseWeight.add(totalDenormalizedFixedWeight).gt(HUNDRED_PERCENT)
      ? initialBaseWeight.sub(
          percentage(initialBaseWeight, totalDenormalizedBaseWeight).mul(delta).div(HUNDRED_PERCENT)
        )
      : initialBaseWeight.add(
          percentage(initialBaseWeight, totalDenormalizedBaseWeight).mul(delta).div(HUNDRED_PERCENT)
        );

    return adjustedBaseWeight;
  });

  return finalWeights;
};

describe('IndexPoolUtils', function () {
  let normalizerInstance: Contract;

  beforeEach(async () => {
    const normalizerFactory = await ethers.getContractFactory('IndexPoolUtils');
    normalizerInstance = await normalizerFactory.deploy();
    await normalizerInstance.deployed();
  });

  describe('#normalizeInterpolated', () => {
    let expectedWeights: BigNumber[], receivedWeights: BigNumber[];

    describe('with denormalized weights greater than one', () => {
      describe('with 80/20 pool and new token to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0];
        const fixedWeights = [0, 0, 0.01];

        beforeEach(async () => {
          expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
          );
        });

        it('returns the correct weights', async () => {
          receivedWeights.forEach(
            (receivedWeight, idx) => expect(areClose(receivedWeight, expectedWeights[idx])).to.be.true
          );
        });

        it('returns normalized weights', async () => {
          expect(isNormalized(receivedWeights)).to.be.true;
        });
      });

      describe('with 80/20 pool and TWO new tokens to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0, 0];
        const fixedWeights = [0, 0, 0.01, 0.01];

        beforeEach(async () => {
          expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
          );
        });

        it('returns the correct weights', async () => {
          receivedWeights.forEach(
            (receivedWeight, idx) => expect(areClose(receivedWeight, expectedWeights[idx])).to.be.true
          );
        });

        it('returns normalized weights', async () => {
          expect(isNormalized(receivedWeights)).to.be.true;
        });
      });

      describe('with random pool weights', () => {
        const baseWeights = [0.341, 0.362, 0.123412, 0.173588];
        const fixedWeights = [0, 0, 0.01, 0.01];

        beforeEach(async () => {
          expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
          );
        });

        it('returns the correct weights', async () => {
          receivedWeights.forEach(
            (receivedWeight, idx) => expect(areClose(receivedWeight, expectedWeights[idx])).to.be.true
          );
        });

        it('returns normalized weights', async () => {
          expect(isNormalized(receivedWeights)).to.be.true;
        });
      });
    });

    describe('with denormalized weights smoller than one', () => {
      describe('with 60/30/10 pool to be transferred in a ?/?/1 pool', () => {
        const baseWeights = [0.6, 0.3, 0.1];
        const fixedWeights = [0, 0, 0.01];

        beforeEach(async () => {
          expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
          );
        });

        it('returns the correct weights', async () => {
          receivedWeights.forEach(
            (receivedWeight, idx) => expect(areClose(receivedWeight, expectedWeights[idx])).to.be.true
          );
        });

        it('returns normalized weights', async () => {
          expect(isNormalized(receivedWeights)).to.be.true;
        });
      });
    });
  });
});
