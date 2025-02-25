import { getArtifact } from '@balancer-labs/v2-helpers/src/contract';

async function main() {
  console.log('== Deployment measurements ==');

  await measureDeployment('v2-vault/Vault');

  await measureDeployment('v2-pool-weighted/WeightedPool');

  await measureDeployment('v2-pool-weighted/WeightedPool2TokensFactory');

  await measureDeployment('v2-pool-weighted/LiquidityBootstrappingPool');

  await measureDeployment('v2-pool-stable/StablePoolFactory');

  await measureDeployment('v2-pool-weighted/LiquidityBootstrappingPoolFactory');

  await measureDeployment('v2-pool-stable/meta/MetaStablePool');

  await measureDeployment('v2-pool-weighted/InvestmentPoolFactory');

  await measureDeployment('v2-pool-weighted/IndexPool');

  await measureDeployment('v2-pool-weighted/Factory');
}

async function measureDeployment(name: string) {
  console.log(`\n# ${name}`);

  const artifact = await getArtifact(name);
  const bytecodeSizeBytes = artifact.deployedBytecode.slice(2).length / 2;

  console.log(`Deployed bytecode size is ${bytecodeSizeBytes} bytes`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
