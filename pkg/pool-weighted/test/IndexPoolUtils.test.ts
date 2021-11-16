import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from '@ethersproject/contracts';
import { fp } from '../../../pvt/helpers/src/numbers';
import { getExpectedWeights, setupAdjustTokens, setupNewTokens } from './utils/WeightCalculationUtil.test';

const {
  utils: { parseEther },
} = ethers;

const HUNDRED_PERCENT = BigNumber.from(10).pow(18);

const getTotalWeight = (weights: BigNumber[]): BigNumber =>
  weights.reduce((acc, curr) => acc.add(curr), BigNumber.from(0));

describe('IndexPoolUtils', function () {
  let indexPoolUtilsInstance: Contract;

  beforeEach(async () => {
    const indexPoolUtilsFactory = await ethers.getContractFactory('MockIndexPoolUtils');
    indexPoolUtilsInstance = await indexPoolUtilsFactory.deploy();
    await indexPoolUtilsInstance.deployed();
  });

  describe('#normalizeInterpolatedMock', () => {
    let receivedWeights: BigNumber[];

    describe('with denormalized weights greater than one', () => {
      describe('with 80/20 pool and new token to be added w/ 1%', () => {
        const baseWeights = [0.8, 0.2, 0];
        const fixedWeights = [0, 0, 0.01];

        beforeEach(async () => {
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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

      describe('with 60/60/30 pool to change to ?/?/20', () => {
        const baseWeights = [0.6, 0.6, 0.3];
        const fixedWeights = [0, 0, 0.2];

        beforeEach(async () => {
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
          receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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
            receivedWeights = await indexPoolUtilsInstance.normalizeInterpolatedMock(
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

  describe('#getUninitializedTokenWeight', () => {
    describe('with fixed inputs (minimumBalance = 1,000,000)', () => {
      const minimumBalance = 1_000_000;

      describe('with amount of new token before swap is 0', () => {
        const newTokenBalance = 0;
        const expectedWeight = fp(0.011);

        it('returns the correct weight 1.1% ', async () => {
          const receivedWeight = await indexPoolUtilsInstance.getUninitializedTokenWeightMock(
            parseEther(newTokenBalance.toString()),
            parseEther(minimumBalance.toString())
          );

          expect(receivedWeight).to.equal(expectedWeight);
        });
      });

      describe('with amount of new token before swap is 100,000', () => {
        const newTokenBalance = 100_000;
        const expectedWeight = fp(0.0109);

        it('returns the correct weight 1.09% ', async () => {
          const receivedWeight = await indexPoolUtilsInstance.getUninitializedTokenWeightMock(
            parseEther(newTokenBalance.toString()),
            parseEther(minimumBalance.toString())
          );

          expect(receivedWeight).to.equal(expectedWeight);
        });
      });

      describe('with amount of new token before swap is 900,000', () => {
        const newTokenBalance = 900_000;
        const expectedWeight = fp(0.0101);

        it('returns the correct weight 1.0101% ', async () => {
          const receivedWeight = await indexPoolUtilsInstance.getUninitializedTokenWeightMock(
            parseEther(newTokenBalance.toString()),
            parseEther(minimumBalance.toString())
          );

          expect(receivedWeight).to.equal(expectedWeight);
        });
      });

      describe('with amount of new token before swap is 1,000,000', () => {
        const newTokenBalance = 1000_000;
        const expectedWeight = fp(0.01);

        it('returns the correct weight 1% ', async () => {
          const receivedWeight = await indexPoolUtilsInstance.getUninitializedTokenWeightMock(
            parseEther(newTokenBalance.toString()),
            parseEther(minimumBalance.toString())
          );

          expect(receivedWeight).to.equal(expectedWeight);
        });
      });

      describe('with amount of new token before swap is 1,200,000', () => {
        const newTokenBalance = 1_200_000;
        const expectedWeight = fp(0.012);

        it('returns the correct weight 1.2% ', async () => {
          const receivedWeight = await indexPoolUtilsInstance.getUninitializedTokenWeightMock(
            parseEther(newTokenBalance.toString()),
            parseEther(minimumBalance.toString())
          );

          expect(receivedWeight).to.equal(expectedWeight);
        });
      });
    });
  });
});
