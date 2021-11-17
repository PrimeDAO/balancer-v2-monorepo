//SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@openzeppelin/contracts/proxy/Initializable.sol";

contract MockTokenHandler is Initializable {
    address public indexPool;
    IVault public vault;

    modifier onlyIndexPool() {
        require(msg.sender == indexPool, "ONLY_INDEX_POOL");
        _;
    }

    function setIndexPool(address _indexPool, address _vault) external initializer {
        indexPool = _indexPool;
        vault = IVault(_vault);
    }

    function withdrawTokensFromVault() external onlyIndexPool {}
}
