// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Example Contract
 * @author SHIBC CTO Agent
 * @notice Example smart contract template
 * @dev Demonstrates common patterns and security best practices
 */
contract Example is Ownable, ReentrancyGuard {
    // ===========================================
    // State Variables
    // ===========================================

    /// @notice Contract version
    string public constant VERSION = "1.0.0";

    /// @notice Value storage
    uint256 public value;

    /// @notice Mapping of addresses to their balances
    mapping(address => uint256) public balances;

    // ===========================================
    // Events
    // ===========================================

    /// @notice Emitted when value is updated
    event ValueUpdated(uint256 indexed oldValue, uint256 indexed newValue, address indexed updater);

    /// @notice Emitted when deposit is made
    event Deposited(address indexed user, uint256 amount);

    /// @notice Emitted when withdrawal is made
    event Withdrawn(address indexed user, uint256 amount);

    // ===========================================
    // Errors
    // ===========================================

    /// @notice Thrown when value is zero
    error ZeroValue();

    /// @notice Thrown when balance is insufficient
    error InsufficientBalance(uint256 requested, uint256 available);

    // ===========================================
    // Constructor
    // ===========================================

    /**
     * @notice Contract constructor
     * @param initialOwner Address of the initial owner
     * @param initialValue Initial value to set
     */
    constructor(address initialOwner, uint256 initialValue) Ownable(initialOwner) {
        value = initialValue;
    }

    // ===========================================
    // External Functions
    // ===========================================

    /**
     * @notice Update the stored value
     * @dev Only callable by owner
     * @param newValue The new value to store
     */
    function setValue(uint256 newValue) external onlyOwner {
        if (newValue == 0) revert ZeroValue();

        uint256 oldValue = value;
        value = newValue;

        emit ValueUpdated(oldValue, newValue, msg.sender);
    }

    /**
     * @notice Deposit ETH to the contract
     * @dev Adds to sender's balance
     */
    function deposit() external payable {
        if (msg.value == 0) revert ZeroValue();

        balances[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw ETH from the contract
     * @dev Uses nonReentrant modifier for safety
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroValue();

        uint256 userBalance = balances[msg.sender];
        if (amount > userBalance) {
            revert InsufficientBalance(amount, userBalance);
        }

        // Effects before interactions (CEI pattern)
        balances[msg.sender] -= amount;

        // Interaction
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // ===========================================
    // View Functions
    // ===========================================

    /**
     * @notice Get the balance of an address
     * @param account Address to query
     * @return Balance of the account
     */
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    /**
     * @notice Get contract's ETH balance
     * @return Total ETH held by contract
     */
    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
