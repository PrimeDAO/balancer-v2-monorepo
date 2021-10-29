import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from '@ethersproject/contracts';
import { fp } from '../../../pvt/helpers/src/numbers';

const HUNDRED_PERCENT = BigNumber.from(10).pow(18);

const getTotalWeight = (weights: BigNumber[]): BigNumber =>
  weights.reduce((acc, curr) => acc.add(curr), BigNumber.from(0));

const percentage = (a: BigNumber, b: BigNumber): BigNumber => a.mul(HUNDRED_PERCENT).div(b);

const getExpectedWeights = (baseWeightsNumbers: number[], fixWeightsNumbers: number[]): BigNumber[] => {
  const baseWeights = baseWeightsNumbers.map((w) => fp(w));
  const fixWeights = fixWeightsNumbers.map((w) => fp(w));

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

const getDecimalBetween = (min: number, max: number): number =>
  parseFloat((Math.random() * (max - min) + min).toFixed(4));

const getIntegerBetween = (min: number, max: number): number => Math.floor(Math.random() * max + min);

const getRandomBaseWeights = (numWeights: number): number[] => {
  let residual = 1;
  const baseWeights = [];

  for (let i = 0; i < numWeights - 1; i++) {
    let weight;

    do {
      weight = getDecimalBetween(0.005, residual);
    } while ([0, 1].includes(weight));

    residual -= weight;
    baseWeights.push(weight);
  }

  baseWeights.push(residual);

  return baseWeights;
};

const setupNewTokens = (numWeights: number) => {
  const baseWeights = getRandomBaseWeights(numWeights);

  const numberNewTokens = getIntegerBetween(1, 2);
  const fixedWeights = new Array(baseWeights.length).fill(0);
  const initialWeight = 0.01;
  for (let i = 0; i < numberNewTokens; i++) {
    fixedWeights.push(initialWeight);
  }
  const numberAddedTokens = fixedWeights.length - baseWeights.length;

  for (let i = 0; i < numberAddedTokens; i++) {
    baseWeights.push(0);
  }

  return { baseWeights, fixedWeights };
};

const setupAdjustTokens = (numWeights: number) => {
  const baseWeights = getRandomBaseWeights(numWeights);
  const numberAdjustTokens = getIntegerBetween(1, numWeights - 1);
  const fixedWeights = [...baseWeights];

  let residual = 1;
  for (let i = 0; i < numberAdjustTokens; i++) {
    const newWeight = getDecimalBetween(0.01, residual);
    fixedWeights[i] = newWeight;
    baseWeights[i] = 0;
    residual -= newWeight;
  }

  return { baseWeights, fixedWeights };
};

describe.only('IndexPoolUtils', function () {
  let normalizerInstance: Contract;

  beforeEach(async () => {
    const normalizerFactory = await ethers.getContractFactory('IndexPoolUtils');
    normalizerInstance = await normalizerFactory.deploy();
    await normalizerInstance.deployed();
  });

  describe('#normalizeInterpolated', () => {
    let receivedWeights: BigNumber[];

    describe('with denormalized weights greater than one', () => {
      describe('with 80/20 pool and new token to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0];
        const fixedWeights = [0, 0, 0.01];

        beforeEach(async () => {
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => fp(w)),
            fixedWeights.map((w) => fp(w))
          );
        });

        it('returns the correct weights 79.2/19.8/1', async () => {
          const expectedWeights = [0.792, 0.198, 0.01].map((pct) => fp(pct));
          expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
        });

        it('returns normalized weights', async () => {
          expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
        });
      });

      describe('with 80/20 pool and TWO new tokens to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0, 0];
        const fixedWeights = [0, 0, 0.01, 0.01];

        beforeEach(async () => {
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => fp(w)),
            fixedWeights.map((w) => fp(w))
          );
        });

        it('returns the correct weights 78.4/19.6/2', async () => {
          const expectedWeights = [0.784, 0.196, 0.01, 0.01].map((pct) => fp(pct));
          expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
        });

        it('returns normalized weights', async () => {
          expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
        });
      });

      // describe('with random pool weights', () => {
      //   const baseWeights = [0.341, 0.362, 0.123412, 0.173588];
      //   const fixedWeights = [0, 0, 0.01, 0.01];

      //   beforeEach(async () => {
      // receivedWeights = await normalizerInstance.normalizeInterpolated(
      //   baseWeights.map((w) => fp(w)),
      //   fixedWeights.map((w) => fp(w))
      // );
      //   });

      //   it('returns the correct weights', async () => {
      //     const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
      //     receivedWeights.forEach(
      //       (receivedWeight, idx) => expect(areClose(receivedWeight, expectedWeights[idx])).to.be.true
      //     );
      //   });

      //   it('returns normalized weights', async () => {
      //     expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
      //   });
      // });
    });

    describe('with denormalized weights smoller than one', () => {
      describe('with 60/30/10 pool to be transferred in a ?/?/1 pool', () => {
        const baseWeights = [0.6, 0.3, 0.1];
        const fixedWeights = [0, 0, 0.01];

        beforeEach(async () => {
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => fp(w)),
            fixedWeights.map((w) => fp(w))
          );
        });

        it('returns the correct weights 66/33/1', async () => {
          const expectedWeights = [0.66, 0.33, 0.01].map((pct) => fp(pct));
          expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
        });

        it('returns normalized weights', async () => {
          expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
        });
      });
    });

    describe.only('with random input weights', () => {
      let baseWeights: number[], fixedWeights: number[];

      describe('with 2 base weights', () => {
        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(2));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });

        describe('when adjusting existing tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupAdjustTokens(2));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });
      });

      describe('with 3 base weights', () => {
        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(3));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });

        describe('when adjusting existing tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupAdjustTokens(3));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });
      });

      describe('with 4 base weights', () => {
        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(4));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });

        describe('when adjusting existing tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupAdjustTokens(4));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });
      });

      describe('with 5 base weights', () => {
        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(5));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });

        describe('when adjusting existing tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupAdjustTokens(5));
            receivedWeights = await normalizerInstance.normalizeInterpolated(
              baseWeights.map((w) => fp(w)),
              fixedWeights.map((w) => fp(w))
            );
          });

          it('returns the correct weights', () => {
            const expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
            expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
          });

          it('returns normalized weights', async () => {
            expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
          });
        });
      });
    });
  });
});
