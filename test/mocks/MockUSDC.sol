// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public transferFromResult = true;
    uint256 public transferFee;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setTransferFromResult(bool value) external {
        transferFromResult = value;
    }

    function setTransferFee(uint256 amount) external {
        transferFee = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (!transferFromResult) return false;
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - transferFee;
        return true;
    }
}
