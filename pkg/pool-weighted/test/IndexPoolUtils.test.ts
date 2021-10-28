import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from '@ethersproject/contracts';

const toBnPercentage = (decimalPercentage: number): BigNumber => {
  const normalizedWeight = decimalPercentage * 10e17;
  return BigNumber.from(normalizedWeight.toString());
};

const getExpectedWeights = (baseWeights: number[], fixWeights: number[]): BigNumber[] => {
  let totalDenormalizedBaseWeight = 0;
  let totalDenormalizedFixedWeight = 0;

  for (let i = 0; i < baseWeights.length; i++) {
    totalDenormalizedFixedWeight += fixWeights[i];
    if (fixWeights[i] == 0) totalDenormalizedBaseWeight += baseWeights[i];
  }

  const sign = totalDenormalizedBaseWeight + totalDenormalizedFixedWeight > 1 ? -1 : 1;
  const delta = Math.abs(1 - totalDenormalizedBaseWeight - totalDenormalizedFixedWeight);

  const finalWeights = baseWeights.map((initialBaseWeight: number, idx: number) => {
    if (fixWeights[idx] != 0) return toBnPercentage(fixWeights[idx]);

    const adjustedBaseWeight = initialBaseWeight + sign * (initialBaseWeight / totalDenormalizedBaseWeight) * delta;

    return toBnPercentage(adjustedBaseWeight);
  });

  return finalWeights;
};

describe.only('IndexPoolUtils', function () {
  let normalizerInstance: Contract;

  beforeEach(async () => {
    const normalizerFactory = await ethers.getContractFactory('IndexPoolUtils');
    normalizerInstance = await normalizerFactory.deploy();
    await normalizerInstance.deployed();
  });

  describe('#normalizeInterpolated', () => {
    describe('with denormalized weights greater than one', () => {
      describe('with 80/20 pool and new token to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0];
        const fixedWeights = [0, 0, 0.01];

        it('returns the correct interpolated normalized weights', async () => {
          const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          const receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
          );

          expect(receivedWeights).to.eql(expectedWeights);
        });
      });

      describe('with 80/20 pool and TWO new tokens to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0, 0];
        const fixedWeights = [0, 0, 0.01, 0.01];

        it('returns the correct interpolated normalized weights', async () => {
          const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          const receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
          );

          expect(receivedWeights).to.eql(expectedWeights);
        });
      });
    });

    describe('with denormalized weights smoller than one', () => {
      describe('with 60/30/10 pool to be transferred in a ?/?/1 pool', () => {
        const baseWeights = [0.6, 0.3, 0.1];
        const fixedWeights = [0, 0, 0.01];

        it('returns the correct interpolated normalized weights', async () => {
          const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          const receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
          );

          expect(receivedWeights).to.eql(expectedWeights);
        });
      });
    });

    // describe('with 60/20/20 pool to be transferred in a ?/?/0 pool, aka removing the last token', () => {
    //   const baseWeights = [toBnPercentage(0.6), toBnPercentage(0.2), toBnPercentage(0.2)];
    //   const fixedWeights = [0, 0, 0];
    //   it('returns the correct interpolated normalized weights', async () => {
    //     const expectedWeights = [toBnPercentage((0.6 / 0.9) * 0.1), toBnPercentage((0.3 / 0.9) * 0.1), 0];
    //     const receivedWeights = await normalizerInstance.normalizeInterpolated(baseWeights, fixedWeights);
    //     expect(receivedWeights).to.eql(expectedWeights);
    //   });
    // });
  });
});
