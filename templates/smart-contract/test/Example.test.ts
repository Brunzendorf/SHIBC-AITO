import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { Example } from '../typechain-types';

describe('Example', function () {
  async function deployFixture() {
    const [owner, user1, user2] = await ethers.getSigners();
    const initialValue = 100n;

    const Example = await ethers.getContractFactory('Example');
    const example = await Example.deploy(owner.address, initialValue);

    return { example, owner, user1, user2, initialValue };
  }

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      const { example, owner } = await loadFixture(deployFixture);
      expect(await example.owner()).to.equal(owner.address);
    });

    it('Should set the initial value', async function () {
      const { example, initialValue } = await loadFixture(deployFixture);
      expect(await example.value()).to.equal(initialValue);
    });

    it('Should return correct version', async function () {
      const { example } = await loadFixture(deployFixture);
      expect(await example.VERSION()).to.equal('1.0.0');
    });
  });

  describe('setValue', function () {
    it('Should allow owner to set value', async function () {
      const { example, owner } = await loadFixture(deployFixture);
      const newValue = 200n;

      await expect(example.connect(owner).setValue(newValue))
        .to.emit(example, 'ValueUpdated')
        .withArgs(100n, newValue, owner.address);

      expect(await example.value()).to.equal(newValue);
    });

    it('Should revert if caller is not owner', async function () {
      const { example, user1 } = await loadFixture(deployFixture);

      await expect(example.connect(user1).setValue(200n)).to.be.revertedWithCustomError(
        example,
        'OwnableUnauthorizedAccount'
      );
    });

    it('Should revert if value is zero', async function () {
      const { example, owner } = await loadFixture(deployFixture);

      await expect(example.connect(owner).setValue(0n)).to.be.revertedWithCustomError(
        example,
        'ZeroValue'
      );
    });
  });

  describe('Deposit', function () {
    it('Should accept deposits', async function () {
      const { example, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther('1.0');

      await expect(example.connect(user1).deposit({ value: amount }))
        .to.emit(example, 'Deposited')
        .withArgs(user1.address, amount);

      expect(await example.balanceOf(user1.address)).to.equal(amount);
    });

    it('Should revert on zero deposit', async function () {
      const { example, user1 } = await loadFixture(deployFixture);

      await expect(example.connect(user1).deposit({ value: 0n })).to.be.revertedWithCustomError(
        example,
        'ZeroValue'
      );
    });
  });

  describe('Withdraw', function () {
    it('Should allow withdrawal', async function () {
      const { example, user1 } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseEther('1.0');
      const withdrawAmount = ethers.parseEther('0.5');

      await example.connect(user1).deposit({ value: depositAmount });

      await expect(example.connect(user1).withdraw(withdrawAmount))
        .to.emit(example, 'Withdrawn')
        .withArgs(user1.address, withdrawAmount);

      expect(await example.balanceOf(user1.address)).to.equal(depositAmount - withdrawAmount);
    });

    it('Should revert on insufficient balance', async function () {
      const { example, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther('1.0');

      await expect(example.connect(user1).withdraw(amount))
        .to.be.revertedWithCustomError(example, 'InsufficientBalance')
        .withArgs(amount, 0n);
    });
  });
});
