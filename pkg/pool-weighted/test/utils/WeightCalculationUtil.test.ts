import { BigNumber } from '@ethersproject/bignumber';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

const HUNDRED_PERCENT = BigNumber.from(10).pow(18);

const percentage = (a: BigNumber, b: BigNumber): BigNumber => a.mul(HUNDRED_PERCENT).div(b);

export const getExpectedWeights = (baseWeightsNumbers: number[], fixWeightsNumbers: number[]): BigNumber[] => {
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

export const getDecimalBetween = (min: number, max: number): number =>
  parseFloat((Math.random() * (max - min) + min).toFixed(4));

// generates random normalized base weights
export const getRandomBaseWeights = (numWeights: number): number[] => {
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

export const getIntegerBetween = (min: number, max: number): number => Math.floor(Math.random() * max + min);

// generates random baseWeights and fixedWeights for the case where the weights of existing tokens in a pool are changed
export const setupAdjustTokens = (numWeights: number) => {
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

// generates random baseWeights and fixedWeights for the case where one or two new tokens are added
export const setupNewTokens = (numWeights: number) => {
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
