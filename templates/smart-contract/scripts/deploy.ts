import { ethers } from 'hardhat';

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();

  console.log('Deploying contracts with account:', deployer.address);
  console.log('Account balance:', (await ethers.provider.getBalance(deployer.address)).toString());

  const initialValue = 100n;

  const Example = await ethers.getContractFactory('Example');
  const example = await Example.deploy(deployer.address, initialValue);

  await example.waitForDeployment();

  const address = await example.getAddress();
  console.log('Example deployed to:', address);

  // Wait for confirmations before verifying
  if (process.env.ETHERSCAN_API_KEY) {
    console.log('Waiting for block confirmations...');
    const tx = example.deploymentTransaction();
    if (tx) {
      await tx.wait(5);
    }

    console.log('Verifying contract...');
    const hre = await import('hardhat');
    await hre.run('verify:verify', {
      address,
      constructorArguments: [deployer.address, initialValue],
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
