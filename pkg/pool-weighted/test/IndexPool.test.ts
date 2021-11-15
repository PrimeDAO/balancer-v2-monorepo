import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { range } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp, pct, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { FundManagement, SingleSwap, SwapKind } from '@balancer-labs/balancer-js';
import { WeightedPoolType } from '../../../pvt/helpers/src/models/pools/weighted/types';
import { calcOutGivenIn } from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';

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
  let owner: SignerWithAddress,
    controller: SignerWithAddress,
    other: SignerWithAddress,
    randomDude: SignerWithAddress,
    vault: Vault;

  before('setup signers', async () => {
    [, owner, other, randomDude] = await ethers.getSigners();
    controller = owner;
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

    it('fails with < 3 tokens', async () => {
      const params = {
        tokens: allTokens.subset(2),
        weights: [fp(0.3), fp(0.7)],
        owner,
        poolType: WeightedPoolType.INDEX_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MIN_TOKENS');

      const params2 = {
        tokens: allTokens.subset(1),
        weights: [fp(0.3)],
        owner: controller,
        poolType: WeightedPoolType.INDEX_POOL,
      };
      await expect(WeightedPool.create(params2)).to.be.revertedWith('MIN_TOKENS');
    });

    it('fails with mismatched tokens/weights', async () => {
      const params = {
        tokens,
        weights: tooManyWeights,
        owner: controller,
        poolType: WeightedPoolType.INDEX_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  describe('weights and scaling factors', () => {
    for (const numTokens of range(3, MAX_TOKENS + 1)) {
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
        owner: controller,
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
          owner: controller,
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

  describe('basic vault interactions', () => {
    const numberExistingTokens = 3;
    const originalWeights = [fp(0.4), fp(0.3), fp(0.3)];
    const initialPoolAmounts = fp(1);
    const initialBalances = Array(numberExistingTokens).fill(initialPoolAmounts);
    const limit = 0; // Minimum amount out
    const deadline = MAX_UINT256;
    const swapAmount = fp(0.0001);

    let poolId: string, singleSwap: SingleSwap, funds: FundManagement, vault: Vault;

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
      poolId = await pool.getPoolId();
    });

    sharedBeforeEach('join pool (aka fund liquidity)', async () => {
      await tokens.mint({ to: owner, amount: fp(100) });
      await tokens.approve({ from: owner, to: await pool.getVault() });
      await pool.init({ from: owner, initialBalances });
    });

    describe('swapping', () => {
      sharedBeforeEach('assemble swap params', async () => {
        singleSwap = {
          poolId,
          kind: SwapKind.GivenIn,
          assetIn: allTokens.third.address,
          assetOut: allTokens.second.address,
          amount: swapAmount,
          userData: '0x',
        };
        funds = {
          sender: owner.address,
          fromInternalBalance: false,
          recipient: owner.address,
          toInternalBalance: false,
        };
      });

      it('adds correct amount tokens of type assetIn to the vault', async () => {
        await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

        const difference = (await tokens.third.balanceOf(vault.address)).sub(initialPoolAmounts);
        expect(difference).to.equal(swapAmount);
      });

      it('removes correct amount tokens of type assetOut from the vault', async () => {
        const defaultFeePercentage = 0.01;
        const defaultFeeAmount = pct(swapAmount, defaultFeePercentage);
        const expectedAmountOut = await pool.estimateGivenIn({
          in: tokens.third,
          out: tokens.second,
          amount: swapAmount.sub(defaultFeeAmount),
        });

        await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

        const vaultDifference = initialPoolAmounts.sub(await tokens.second.balanceOf(vault.address));
        expect(vaultDifference).to.equalWithError(expectedAmountOut, 0.0001);
      });
    });

    describe('exit the pool (aka removing liquidity)', () => {
      const removeAmount = fp(0.6);
      const residualAmount = initialPoolAmounts.sub(removeAmount);

      sharedBeforeEach('remove liquidity', async () => {
        await pool.exitGivenOut({ from: owner, amountsOut: initialBalances.map(() => removeAmount) });
      });

      it('removes the tokens from the vaults balance', async () => {
        const expectedPoolAmounts = initialBalances.map(() => residualAmount);
        const { balances: actualPoolAmounts } = await vault.getPoolTokens(poolId);

        expect(actualPoolAmounts).to.eql(expectedPoolAmounts);
      });
    });
  });

  // describe('#reweighTokens', () => {
  //   sharedBeforeEach('deploy pool', async () => {
  //     const params = {
  //       tokens,
  //       weights,
  //       owner,
  //       poolType: WeightedPoolType.INDEX_POOL,
  //       swapEnabledOnStart: false,
  //     };
  //     pool = await WeightedPool.create(params);
  //   });

  //   context('when input array lengths differ', () => {
  //     it('reverts: "INPUT_LENGTH_MISMATCH"', async () => {
  //       const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
  //       const twoWeights = [fp(0.5), fp(0.5)];

  //       await expect(pool.reweighTokens(threeAddresses, twoWeights)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
  //     });
  //   });

  //   context('when weights are not normalized', () => {
  //     it('reverts: "INPUT_LENGTH_MISMATCH"', async () => {
  //       const addresses = allTokens.subset(2).tokens.map((token) => token.address);
  //       const denormalizedWeights = [fp(0.5), fp(0.3)];

  //       await expect(pool.reweighTokens(addresses, denormalizedWeights)).to.be.revertedWith(
  //         'NORMALIZED_WEIGHT_INVARIANT'
  //       );
  //     });
  //   });

  //   context('with valid inputs', () => {
  //     const desiredWeights = [fp(0.1), fp(0.3), fp(0.5), fp(0.1)];

  //     sharedBeforeEach('deploy pool', async () => {
  //       await pool.reweighTokens(
  //         allTokens.subset(4).tokens.map((token) => token.address),
  //         desiredWeights
  //       );
  //     });

  //     it('sets the correct endWeights', async () => {
  //       const { endWeights } = await pool.getGradualWeightUpdateParams();

  //       expect(endWeights).to.equalWithError(desiredWeights, 0.0001);
  //     });

  //     it('sets the correct rebalancing period', async () => {
  //       const maxWeightDifference = calculateMaxWeightDifference(desiredWeights, weights);
  //       const time = getTimeForWeightChange(maxWeightDifference);
  //       const { startTime, endTime } = await pool.getGradualWeightUpdateParams();

  //       expect(Number(endTime) - Number(startTime)).to.equalWithError(time, 0.0001);
  //     });
  //   });
  // });

  describe('#reindexTokens', () => {
    describe('input validation', () => {
      sharedBeforeEach('deploy pool', async () => {
        vault = await Vault.create();
        const params = {
          tokens: tokens.subset(3),
          weights: [fp(0.6), fp(0.2), fp(0.2)],
          owner: controller,
          poolType: WeightedPoolType.INDEX_POOL,
          fromFactory: true,
          vault,
        };
        pool = await WeightedPool.create(params);
      });

      context('when not called by the controller', () => {
        it('reverts: ""BAL#401 (SENDER_NOT_ALLOWED)"', async () => {
          const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
          const twoWeights = [fp(0.5), fp(0.5)];
          const threeMinimumBalances = [1000, 2000, 3000];

          await expect(pool.reindexTokens(other, threeAddresses, twoWeights, threeMinimumBalances)).to.be.revertedWith(
            'BAL#401'
          );
        });
      });

      context('when input array lengths differ', () => {
        it('reverts "INPUT_LENGTH_MISMATCH" if lengths of tokens and weights differ', async () => {
          const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
          const twoWeights = [fp(0.5), fp(0.5)];
          const threeMinimumBalances = [1000, 2000, 3000];

          await expect(
            pool.reindexTokens(controller, threeAddresses, twoWeights, threeMinimumBalances)
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts "INPUT_LENGTH_MISMATCH" if lengths of tokens and minimum balances differ', async () => {
          const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
          const threeWeights = [fp(0.4), fp(0.5), fp(0.1)];
          const twoMinimumBalances = [1000, 2000];

          await expect(
            pool.reindexTokens(controller, threeAddresses, threeWeights, twoMinimumBalances)
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts "INPUT_LENGTH_MISMATCH" if lengths of weights and minimum balances differ', async () => {
          const threeAddresses = allTokens.subset(3).tokens.map((token) => token.address);
          const twoWeights = [fp(0.5), fp(0.5)];
          const threeMinimumBalances = [1000, 2000, 3000];

          await expect(
            pool.reindexTokens(controller, threeAddresses, twoWeights, threeMinimumBalances)
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });
      });

      context('when a minimum balance is zero', () => {
        it('reverts: "INVALID_ZERO_MINIMUM_BALANCE"', async () => {
          const addresses = allTokens.subset(2).tokens.map((token) => token.address);
          const weights = [fp(0.5), fp(0.5)];
          const invalidMinimumBalances = [1000, 0];

          await expect(pool.reindexTokens(controller, addresses, weights, invalidMinimumBalances)).to.be.revertedWith(
            'Invalid zero minimum balance'
          );
        });
      });
    });

    context('when adding one new token', () => {
      const numberNewTokens = 1;
      const numberExistingTokens = 3;
      const newTokenIndex = 3;
      const oldTokenIndex = 0;
      const newTokenTargetWeight = fp(0.1);
      const originalWeights = [fp(0.4), fp(0.3), fp(0.3)];
      const reindexWeights = [fp(0.5), fp(0.2), fp(0.2), newTokenTargetWeight];
      const standardMinimumBalance = fp(0.01);
      const swapInAmount = fp(0.003);
      const initialTokenAmountsInPool = fp(1);
      const defaultUninitializedWeight = fp(0.01);
      const minimumBalances = new Array(numberExistingTokens + numberNewTokens).fill(standardMinimumBalance);

      const expectedNewStartWeights = [fp(0.396), fp(0.297), fp(0.297), fp(0.01)];
      const expectedIntermediateEndWeights = [fp(0.55), fp(0.22), fp(0.22), defaultUninitializedWeight];

      let reindexTokens: string[], poolId: string;

      sharedBeforeEach('deploy pool', async () => {
        vault = await Vault.create();

        const params = {
          tokens: tokens.subset(numberExistingTokens),
          weights: originalWeights,
          owner: controller,
          poolType: WeightedPoolType.INDEX_POOL,
          fromFactory: true,
          vault,
        };

        pool = await WeightedPool.create(params);
      });

      sharedBeforeEach('join pool (aka fund liquidity)', async () => {
        await tokens.mint({ to: owner, amount: fp(100) });
        await tokens.approve({ from: owner, to: await pool.getVault() });
        await pool.init({
          from: owner,
          initialBalances: new Array(numberExistingTokens).fill(initialTokenAmountsInPool),
        });
      });

      sharedBeforeEach('call reindexTokens function', async () => {
        reindexTokens = allTokens.subset(numberExistingTokens + numberNewTokens).tokens.map((token) => token.address);
        poolId = await pool.getPoolId();
        await pool.reindexTokens(controller, reindexTokens, reindexWeights, minimumBalances);
      });

      it('adds the new token to the vault registry', async () => {
        const { tokens: tokensFromVault } = await vault.getPoolTokens(poolId);

        expect(tokensFromVault).to.have.members(reindexTokens);
      });

      it('sets the correct startWeights for all four tokens including the immediate', async () => {
        const { startWeights } = await pool.getGradualWeightUpdateParams();

        expect(startWeights).to.equalWithError(expectedNewStartWeights, 0.0001);
      });

      it('sets the correct endWeights for all four tokens', async () => {
        const { endWeights } = await pool.getGradualWeightUpdateParams();

        expect(endWeights).to.equalWithError(expectedIntermediateEndWeights, 0.0001);
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

      context('when attempting to swap new token out of pool', () => {
        it('reverts "Uninitialized token"', async () => {
          const singleSwap = {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: reindexTokens[0],
            assetOut: reindexTokens[newTokenIndex],
            amount: swapInAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: other.address,
            toInternalBalance: false,
          };
          const limit = 0; // Minimum amount out
          const deadline = MAX_UINT256;

          await expect(vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline)).to.be.revertedWith(
            'Uninitialized token'
          );
        });
      });

      context('when swapping new token into the pool', () => {
        sharedBeforeEach('swap token into pool', async () => {
          const singleSwap = {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: reindexTokens[newTokenIndex],
            assetOut: reindexTokens[0],
            amount: swapInAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: randomDude.address,
            toInternalBalance: false,
          };
          const limit = 0; // Minimum amount out
          const deadline = MAX_UINT256;
          await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);
        });

        it('returns the correct amount to the swapper', async () => {
          const defaultFeePercentage = 0.01;
          const defaultFeeAmount = pct(swapInAmount, defaultFeePercentage);
          const expectedAmount = Math.floor(
            calcOutGivenIn(
              standardMinimumBalance,
              defaultUninitializedWeight,
              initialTokenAmountsInPool,
              expectedNewStartWeights[oldTokenIndex],
              swapInAmount.sub(defaultFeeAmount)
            ).toNumber()
          );

          const afterSwapTokenBalance = await allTokens.first.balanceOf(randomDude);

          expect(afterSwapTokenBalance).to.equalWithError(expectedAmount, 0.001);
        });
      });

      context('when the new token becomes initialized', () => {
        const numberOfSwapsUntilInitialization = 4;
        const weightAdjustmentFactor =
          (4 * fromFp(swapInAmount).toNumber()) / fromFp(defaultUninitializedWeight).toNumber();
        // when the new token becomes initialized its weight is immediately adjusted relatively to the amount that its
        // balance exceeds its minimumBalance
        const expectedNewStartWeightsAfterInit = [
          fp(0.3952),
          fp(0.2964),
          fp(0.2964),
          fp(fromFp(defaultUninitializedWeight).toNumber() * weightAdjustmentFactor),
        ];

        sharedBeforeEach('swap token into pool', async () => {
          const singleSwap = {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: reindexTokens[newTokenIndex],
            assetOut: reindexTokens[0],
            amount: swapInAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: randomDude.address,
            toInternalBalance: false,
          };
          const limit = 0; // Minimum amount out
          const deadline = MAX_UINT256;

          // do four swaps => will push new token balance over minimum balance
          for (let i = 0; i < numberOfSwapsUntilInitialization; i++) {
            await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);
          }
        });

        it('resets the minimum balance for the to-be-intialized token to zero', async () => {
          const minimumBalance = await pool.minBalances(reindexTokens[newTokenIndex]);
          expect(minimumBalance).to.equal(0);
        });

        it('sets the final endWeights for all tokens', async () => {
          const { endWeights } = await pool.getGradualWeightUpdateParams();

          expect(endWeights).to.equalWithError(reindexWeights, 0.0001);
        });

        it('sets the correct startWeights for all tokens', async () => {
          const { startWeights: newStartWeights } = await pool.getGradualWeightUpdateParams();
          expect(newStartWeights).to.equalWithError(expectedNewStartWeightsAfterInit, 0.0001);
        });

        it('resets the targetWeight for the initialized token to zero', async () => {
          const expectedNewTokenTargetWeights = new Array(numberExistingTokens + numberNewTokens).fill(fp(0));
          const { newTokenTargetWeights } = await pool.getGradualWeightUpdateParams();

          expect(newTokenTargetWeights).to.eql(expectedNewTokenTargetWeights);
        });
      });
    });

    context('when adding two new tokens', () => {
      const numberNewTokens = 2;
      const numberExistingTokens = 3;
      const newTokenIndex = 3;
      const firstNewTokenTargetWeight = fp(0.1);
      const secondNewTokenTargetWeight = fp(0.2);
      const originalWeights = [fp(0.4), fp(0.3), fp(0.3)];
      const reindexWeights = [fp(0.5), fp(0.1), fp(0.1), firstNewTokenTargetWeight, secondNewTokenTargetWeight];
      const standardMinimumBalance = fp(0.01);
      const swapInAmount = fp(0.003);
      const initialTokenAmountsInPool = fp(1);
      const minimumBalances = new Array(numberExistingTokens + numberNewTokens).fill(standardMinimumBalance);

      const expectedNewStartWeights = [fp(0.3912), fp(0.2934), fp(0.2934), fp(0.012), fp(0.01)];
      const secondEndWeights = [fp(0.61875), fp(0.12375), fp(0.12375), fp(0.12375), fp(0.01)];

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

      sharedBeforeEach('join pool (aka fund liquidity)', async () => {
        await tokens.mint({ to: owner, amount: fp(100) });
        await tokens.approve({ from: owner, to: await pool.getVault() });
        await pool.init({
          from: owner,
          initialBalances: new Array(numberExistingTokens).fill(initialTokenAmountsInPool),
        });
      });

      sharedBeforeEach('call reindexTokens function', async () => {
        reindexTokens = allTokens.subset(numberExistingTokens + numberNewTokens).tokens.map((token) => token.address);
        poolId = await pool.getPoolId();
        await pool.reindexTokens(controller, reindexTokens, reindexWeights, minimumBalances);
      });

      context('when one of the two tokens becomes initialized', () => {
        sharedBeforeEach('swap token into pool', async () => {
          const numberOfSwapsUntilInitialization = 4;

          const singleSwap = {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: reindexTokens[newTokenIndex],
            assetOut: reindexTokens[0],
            amount: swapInAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: randomDude.address,
            toInternalBalance: false,
          };
          const limit = 0; // Minimum amount out
          const deadline = MAX_UINT256;

          for (let i = 0; i < numberOfSwapsUntilInitialization; i++) {
            await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);
          }
        });

        it('resets the minimum balance for the to-be-intialized token to zero', async () => {
          const minimumBalance = await pool.minBalances(reindexTokens[newTokenIndex]);
          expect(minimumBalance).to.equal(0);
        });

        it('sets the final endWeights for all tokens', async () => {
          const { endWeights } = await pool.getGradualWeightUpdateParams();

          expect(endWeights).to.equalWithError(secondEndWeights, 0.0001);
        });

        it('sets the correct startWeights for all tokens', async () => {
          const { startWeights } = await pool.getGradualWeightUpdateParams();
          expect(startWeights).to.equalWithError(expectedNewStartWeights, 0.0001);
        });

        it('updates the newTokenTargetWeights', async () => {
          const expectedNewTokenTargetWeights = [fp(0), fp(0), fp(0), fp(0), secondNewTokenTargetWeight];
          const { newTokenTargetWeights } = await pool.getGradualWeightUpdateParams();

          expect(newTokenTargetWeights).to.eql(expectedNewTokenTargetWeights);
        });
      });
    });
  });
});
