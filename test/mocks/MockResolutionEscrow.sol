// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockResolutionEscrow {
    address public buyerAddress;
    address public sellerAddress;
    address public arbitrationAddress;
    mapping(uint256 => uint8) public milestoneStates;
    mapping(uint256 => address) public recipients;

    constructor(address buyer_, address seller_, address router_) {
        buyerAddress = buyer_;
        sellerAddress = seller_;
        arbitrationAddress = router_;
    }

    function setDisputed(uint256 index) external {
        milestoneStates[index] = 5;
    }

    function forceRelease(uint256 index) external {
        milestoneStates[index] = 6;
    }

    function arbitrate(uint256 index, address recipient) external {
        require(msg.sender == arbitrationAddress, "router");
        require(milestoneStates[index] == 5, "state");
        recipients[index] = recipient;
        milestoneStates[index] = 6;
    }
}
