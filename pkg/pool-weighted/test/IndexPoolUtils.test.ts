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

// generates random normalized base weights
const getRandomBaseWeights = (numWeights: number): number[] => {
  let residual = 1;
  const baseWeights = [];

  for (let i = 0; i < numWeights - 1; i++) {
    const weight = getDecimalBetween(Number.MIN_VALUE, residual / 2);

    residual -= weight;
    baseWeights.push(weight);
  }

  baseWeights.push(residual);

  return baseWeights;
};

// generates random baseWeights and fixedWeights for the case where one or two new tokens are added
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

// generates random baseWeights and fixedWeights for the case where the weights of existing tokens in a pool are changed
const setupAdjustTokens = (numWeights: number) => {
  const baseWeights = getRandomBaseWeights(numWeights);
  const numberAdjustTokens = getIntegerBetween(1, numWeights - 1);
  const fixedWeights = new Array(numWeights).fill(0);

  let residual = 1;
  for (let i = 0; i < numberAdjustTokens; i++) {
    const newWeight = getDecimalBetween(Number.MIN_VALUE, residual / 2);
    fixedWeights[i] = newWeight;
    baseWeights[i] = 0;
    residual -= newWeight;
  }

  return { baseWeights, fixedWeights };
};

describe('IndexPoolUtils', function () {
  let indexPoolUtilsInstance: Contract;

  beforeEach(async () => {
    const indexPoolUtilsFactory = await ethers.getContractFactory('MockIndexPoolUtils');
    indexPoolUtilsInstance = await indexPoolUtilsFactory.deploy();
    await indexPoolUtilsInstance.deployed();
  });

  describe('#normalizeInterpolated', () => {
    let receivedWeights: BigNumber[];

    describe('with denormalized weights greater than one', () => {
      describe('with 80/20 pool and new token to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0];
        const fixedWeights = [0, 0, 0.01];

        beforeEach(async () => {
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 50/50 pool and ONE new tokens to be added w/ 20%', () => {
        const baseWeights = [0.5, 0.5, 0];
        const fixedWeights = [0, 0, 0.2];

        beforeEach(async () => {
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
            baseWeights.map((w) => fp(w)),
            fixedWeights.map((w) => fp(w))
          );
        });

        it('returns the correct weights 40/40/20', async () => {
          const expectedWeights = [0.4, 0.4, 0.2].map((pct) => fp(pct));
          expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
        });

        it('returns normalized weights', async () => {
          expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
        });
      });

      describe('with 60/60/30 pool to change to 0/0/20', () => {
        const baseWeights = [0.6, 0.6, 0.3];
        const fixedWeights = [0, 0, 0.2];

        beforeEach(async () => {
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
            baseWeights.map((w) => fp(w)),
            fixedWeights.map((w) => fp(w))
          );
        });

        it('returns the correct weights 40/40/20', async () => {
          const expectedWeights = [0.4, 0.4, 0.2].map((pct) => fp(pct));
          expect(receivedWeights).to.equalWithError(expectedWeights, 0.0001);
        });

        it('returns normalized weights', async () => {
          expect(getTotalWeight(receivedWeights)).to.equal(HUNDRED_PERCENT);
        });
      });
    });

    describe('with denormalized weights smoller than one', () => {
      describe('with 60/30/10 pool to be transferred in a ?/?/1 pool', () => {
        const baseWeights = [0.6, 0.3, 0.1];
        const fixedWeights = [0, 0, 0.01];

        beforeEach(async () => {
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

    describe('with random input weights', () => {
      let baseWeights: number[], fixedWeights: number[];

      describe('with 2 base weights', () => {
        const numberWeights = 2;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
        const numberWeights = 3;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
        const numberWeights = 4;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
        const numberWeights = 5;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 6 base weights', () => {
        const numberWeights = 6;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 7 base weights', () => {
        const numberWeights = 7;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 8 base weights', () => {
        const numberWeights = 8;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 9 base weights', () => {
        const numberWeights = 9;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 10 base weights', () => {
        const numberWeights = 10;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 11 base weights', () => {
        const numberWeights = 11;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 12 base weights', () => {
        const numberWeights = 12;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 13 base weights', () => {
        const numberWeights = 13;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 14 base weights', () => {
        const numberWeights = 14;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 15 base weights', () => {
        const numberWeights = 15;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 16 base weights', () => {
        const numberWeights = 16;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 17 base weights', () => {
        const numberWeights = 17;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 18 base weights', () => {
        const numberWeights = 18;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 19 base weights', () => {
        const numberWeights = 19;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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

      describe('with 20 base weights', () => {
        const numberWeights = 20;

        describe('when adding tokens', () => {
          beforeEach(async () => {
            ({ baseWeights, fixedWeights } = setupNewTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
            ({ baseWeights, fixedWeights } = setupAdjustTokens(numberWeights));
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolated(
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
