// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DocumentaryTradeEscrow} from "../src/DocumentaryTradeEscrow.sol";
import {DocumentaryTradeEscrowFactory} from "../src/DocumentaryTradeEscrowFactory.sol";

contract DocumentaryTradeEscrowFactoryTest is Test {
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0x5E11E7);
    address internal constant ARBITER = address(0xAAB1);
    address internal constant OPERATOR = address(0x0A11CE);

    DocumentaryTradeEscrowFactory internal factory;

    function setUp() public {
        factory = new DocumentaryTradeEscrowFactory(ARBITER, OPERATOR);
    }

    function testCreatesAndIndexesEscrowPerAgreement() public {
        bytes32 id = keccak256("agreement-1");
        vm.prank(BUYER);
        address escrowAddress = factory.createAgreement(id, SELLER, 20_000_000, block.timestamp + 7 days, 1 days, 1 days);

        DocumentaryTradeEscrow escrow = DocumentaryTradeEscrow(escrowAddress);
        assertEq(escrow.buyerAddress(), BUYER);
        assertEq(escrow.sellerAddress(), SELLER);
        assertEq(escrow.arbitrationAddress(), ARBITER);
        assertEq(escrow.operatorAddress(), OPERATOR);

        DocumentaryTradeEscrowFactory.Agreement memory agreement = factory.getAgreement(id);
        assertEq(agreement.escrow, escrowAddress);
        assertEq(agreement.buyer, BUYER);
        assertEq(agreement.seller, SELLER);
        assertEq(factory.agreementsOf(BUYER)[0], id);
        assertEq(factory.agreementsOf(SELLER)[0], id);
    }

    function testAgreementIdsCannotBeReused() public {
        bytes32 id = keccak256("agreement-1");
        vm.prank(BUYER);
        factory.createAgreement(id, SELLER, 20_000_000, block.timestamp + 7 days, 1 days, 1 days);
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrowFactory.AgreementExists.selector);
        factory.createAgreement(id, SELLER, 20_000_000, block.timestamp + 7 days, 1 days, 1 days);
    }
}
