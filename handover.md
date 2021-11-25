# Handover

## 1. Specification

### 1.1. Rebalancing

#### 1.1.1. General

- [x] there is public function `reweighTokens`
- [x] it takes the following arguments:
  - [x] IERC20[] calldata tokens
  - [x] uint256[] calldata desiredWeights
- [x] input validation:
  - [x] it reverts if input arrays are malformed
- [x] can only be called by controller

#### 1.1.2. Cases

- [x] base case: the fn parameters contain target weights for all pool tokens, in the pool there is no uninitialized token and no token to be removed atm
  - [x] a new rebalancing process is initialized using the current weights as start weights and the target weights as end weights
  - [x] the endTime is calculated such that the weight change per day for the token with the largest absolute weight change is 1% per day (consequently the weight change for the other tokens is smaller than that)
- [ ] case: the fn parameters contain target weights for all pool tokens, there is an uninitialized token in the pool
  - [ ] only the target weights of the initialized tokens are changed, the uninitialized token stays at 1%
  - [ ] the new target weight of the uninitialized token is stored for later use
- [ ] case: there is a token that is currently being removed from the pool, there is no target weight specified for this token by the fn params
  - [ ] the target weights for the tokens from the params are set correctly (adjusted by the 1% target weight of the to-be-removed-token)

### 1.2. Reindexing

#### 1.2.1. General

- [x] there is public function `reweighTokens`
- [x] input validation
- [x] can only be called by controller

#### 1.2.2. Cases

- [x] adding one token
  - [x] if a token passed to `reindexTokens` does not yet exist in the process to add a token is initiated
  - [x] it's weight is set to 1% as long as it is uninitialized (uninitialized = the token's pool balance is below the specified minimumBalance)
  - [x] it can only be swapped into the pool, but not out
  - [x] if the token is swapped the price is calculacted based on the 1% base weight and a fake pool balance of minimumBalance
  - [ ] price premium mechanism
    - [ ] the token's weight is increased by a premium depending on how far its pool balance is away from the minimumBalance
    - [x] the util function to calculcate this "incentivized weight" has been built `IndexPoolUtils.getUninitializedTokenWeight`
  - [x] initialization behavior:
    - [x] if a swap pushes it's pool balance over the minimumBalance the token becomes initialized
    - [x] its current weight is immediately adjusted relative to the amount that its pool balance exceeds the minimum balance
    - [x] a new rebalancing is initiaited, this time taking into account the final target weight of the initialized token (as provided by the original reindex call)
- [x] adding multiple tokens at once
- [x] removing one token
  - [x] if a pool token is not contained by the params of `reindexTokens` the process to remove that token is initiated
  - [x] its target weight is set to 1% and it is flagged to be removed
  - [x] it can only be swapped out of the pool but not in
  - [x] if the token has reached 1% its residual amount can be sent to a token handler contract by calling `removeFinalizedTokens` which removes the token from the pool
- [x] removing multiple tokens at once
- [x] adding & removing tokens at once

## 2. Documentation

### 2.1. General V2 design

Balancer V2's architecture builds on the premise that pool and vault are separate contracts. The vault holds all tokens, keeps a registry of available pools and their respective token balances. If a user makes a basic interaction with a pool such as swapping, joinning or exiting, this happens through an interaction with the vault (thereby the user specifies with which pool they want to interact). The vault will forward the interaction to the respective pool, whose implementation determines the exact swap, join, or exit logic (e.g. how much a user will receive for a given swap). This division between pool and vault has significant implications on the possible design space for the `IndexPool`.

### 2.2. Starting point: InvestmentPool

Balancer is currently working on a new smart pool implementation, the `InvestmentPool`. This pool is meant to cater for a large amount of tokens, to allow for reweighing and more. However, the InvestmentPool is work in progress. The InvestmentPool was used as starting point for the IndexPool implementation, since it shares many of its desired features.
