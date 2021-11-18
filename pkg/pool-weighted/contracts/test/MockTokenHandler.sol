//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IBasePool.sol";
import "@openzeppelin/contracts/proxy/Initializable.sol";

contract MockTokenHandler is Initializable {
    address public indexPool;
    IVault public vault;

    modifier onlyIndexPool() {
        require(msg.sender == indexPool, "ONLY_INDEX_POOL");
        _;
    }

    function setup(IVault _vault) external initializer {
        indexPool = msg.sender;
        vault = _vault;
    }

    function withdrawTokensFromVault(IERC20[] memory tokens, uint256[] memory amounts) external onlyIndexPool {
        bytes32 poolId = IBasePool(indexPool).getPoolId();

        IVault.PoolBalanceOp[] memory withdrawals = new IVault.PoolBalanceOp[](tokens.length);

        for (uint8 i; i < tokens.length; i++) {
            IVault.PoolBalanceOp memory withdrawParams = IVault.PoolBalanceOp({
                kind: IVault.PoolBalanceOpKind.WITHDRAW,
                poolId: poolId,
                token: tokens[i],
                amount: amounts[i]
            });
            withdrawals[i] = withdrawParams;
        }

        vault.managePoolBalance(withdrawals);
    }
}
