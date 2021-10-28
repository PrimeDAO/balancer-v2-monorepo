import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from '@ethersproject/contracts';
import { pct } from '../../../pvt/helpers/src/numbers';

const HUNDRED_PERCENT = BigNumber.from(10).pow(18);

const isNormalized = (weights: BigNumber[]): boolean => {
  const HUNDRED_PERCENT = BigNumber.from(10).pow(18);

  const totalWeight = weights.reduce((acc, curr) => acc.add(curr), BigNumber.from(0));
  return totalWeight.eq(HUNDRED_PERCENT);
};

const toBnPercentage = (decimalPercentage: number): BigNumber => {
  const normalizedWeight = decimalPercentage * 10e17;
  return BigNumber.from(normalizedWeight.toString());
};

// function _bdiv(uint256 a, uint256 b) internal pure returns (uint256) {
//   require(b != 0, "ERR_DIV_ZERO");
//   uint256 c0 = a * BONE;
//   require(a == 0 || c0 / a == BONE, "ERR_DIV_INTERNAL"); // bmul overflow
//   uint256 c1 = c0 + (b / 2);
//   require(c1 >= c0, "ERR_DIV_INTERNAL"); //  badd require
//   uint256 c2 = c1 / b;
//   return c2;
// }

const percentage = (a: BigNumber, b: BigNumber): BigNumber => a.mul(HUNDRED_PERCENT).div(b);

// const getExpectedWeights = (baseWeights: number[], fixWeights: number[]): BigNumber[] => {
//   let totalDenormalizedBaseWeight = 0;
//   let totalDenormalizedFixedWeight = 0;

//   for (let i = 0; i < baseWeights.length; i++) {
//     totalDenormalizedFixedWeight += fixWeights[i];
//     if (fixWeights[i] == 0) totalDenormalizedBaseWeight += baseWeights[i];
//   }

//   const sign = totalDenormalizedBaseWeight + totalDenormalizedFixedWeight > 1 ? -1 : 1;
//   const delta = Math.abs(1 - totalDenormalizedBaseWeight - totalDenormalizedFixedWeight);

//   const finalWeights = baseWeights.map((initialBaseWeight: number, idx: number) => {
//     if (fixWeights[idx] != 0) return toBnPercentage(fixWeights[idx]);

//     const adjustedBaseWeight = initialBaseWeight + sign * (initialBaseWeight / totalDenormalizedBaseWeight) * delta;

//     return toBnPercentage(adjustedBaseWeight);
//   });

//   return finalWeights;
// };

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
    // const adjustedBaseWeight = initialBaseWeight + sign * (initialBaseWeight / totalDenormalizedBaseWeight) * delta;

    const adjustedBaseWeight = totalDenormalizedBaseWeight.add(totalDenormalizedFixedWeight).gt(HUNDRED_PERCENT)
      ? initialBaseWeight.sub(
          percentage(initialBaseWeight, totalDenormalizedBaseWeight).mul(delta).div(HUNDRED_PERCENT)
        )
      : initialBaseWeight.add(
          percentage(initialBaseWeight, totalDenormalizedBaseWeight).mul(delta).div(HUNDRED_PERCENT)
        );
    console.log('initialBaseWeight');
    console.log(initialBaseWeight.toString());
    console.log('adjustedBaseWeight');
    console.log(adjustedBaseWeight.toString());
    // console.log('adjustmentSum');
    // console.log(pct(initialBaseWeight, totalDenormalizedBaseWeight).mul(delta).toString());
    return adjustedBaseWeight;
  });

  return finalWeights;
};

// const getExpectedWeights = (baseWeights: number[], fixWeights: number[]): BigNumber[] => {
//   let totalDenormalizedBaseWeight = 0;
//   let totalDenormalizedFixedWeight = 0;

//   for (let i = 0; i < baseWeights.length; i++) {
//     totalDenormalizedFixedWeight += fixWeights[i];
//     if (fixWeights[i] == 0) totalDenormalizedBaseWeight += baseWeights[i];
//   }

//   const sign = totalDenormalizedBaseWeight + totalDenormalizedFixedWeight > 1 ? -1 : 1;
//   const delta = Math.abs(1 - totalDenormalizedBaseWeight - totalDenormalizedFixedWeight);

//   const finalWeights = baseWeights.map((initialBaseWeight: number, idx: number) => {
//     if (fixWeights[idx] != 0) return toBnPercentage(fixWeights[idx]);

//     const adjustedBaseWeight = initialBaseWeight + sign * (initialBaseWeight / totalDenormalizedBaseWeight) * delta;
//     console.log('adjustmentSum');
//     console.log((initialBaseWeight / totalDenormalizedBaseWeight) * delta);
//     return toBnPercentage(adjustedBaseWeight);
//   });

//   return finalWeights;
// };

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
          expect(receivedWeights).to.eql(expectedWeights);
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
          expect(receivedWeights).to.eql(expectedWeights);
        });

        it('returns normalized weights', async () => {
          expect(isNormalized(receivedWeights)).to.be.true;
        });
      });

      describe('with crazy pool', () => {
        const baseWeights = [0.341, 0.362, 0.123412, 0.173588];
        const fixedWeights = [0, 0, 0.01, 0.01];

        beforeEach(async () => {
          expectedWeights = getExpectedWeights(baseWeights, fixedWeights);
          receivedWeights = await normalizerInstance.normalizeInterpolated(
            baseWeights.map((w) => toBnPercentage(w)),
            fixedWeights.map((w) => toBnPercentage(w))
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

        it.only('returns the correct weights', async () => {
          console.log('A');
          console.log(receivedWeights[0].toString());
          console.log('B');
          console.log(expectedWeights[0].toString());
          expect(receivedWeights).to.eql(expectedWeights);
        });

        it.only('returns normalized weights', async () => {
          expect(isNormalized(receivedWeights)).to.be.true;
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
