// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract MockGatewayWallet {
    mapping(address => mapping(address => uint256)) public balanceOf;

    function deposit(address token, uint256 value) external {
        require(IMockERC20(token).transferFrom(msg.sender, address(this), value), "transfer failed");
        balanceOf[token][msg.sender] += value;
    }
}
