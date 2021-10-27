import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from '@ethersproject/contracts';

const toBnPercentage = (decimalPercentage: number): BigNumber => {
  const normalizedWeight = decimalPercentage * 10e17;
  return BigNumber.from(normalizedWeight.toString());
};

describe('WeightNormalizer', function () {
  let normalizerInstance: Contract;

  beforeEach(async () => {
    const normalizerFactory = await ethers.getContractFactory('WeightNormalizer');
    normalizerInstance = await normalizerFactory.deploy();
    await normalizerInstance.deployed();
  });

  describe('#normalize', () => {
    describe('with 80/20 pool and new token to be added w/ 1%', () => {
      const baseWeights = [toBnPercentage(0.8), toBnPercentage(0.2), 0];
      const fixedWeights = [0, 0, toBnPercentage(0.01)];

      it('returns the correct interpolated normalized weights', async () => {
        const expectedWeights = [toBnPercentage(0.792), toBnPercentage(0.198), toBnPercentage(0.01)];
        const receivedWeights = await normalizerInstance.normalizeInterpolated(baseWeights, fixedWeights);

        expect(receivedWeights).to.eql(expectedWeights);
      });
    });
  });
});
