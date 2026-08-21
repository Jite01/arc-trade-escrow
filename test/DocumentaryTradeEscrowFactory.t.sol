// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DocumentaryTradeEscrow} from "../src/DocumentaryTradeEscrow.sol";
import {DocumentaryTradeEscrowFactory} from "../src/DocumentaryTradeEscrowFactory.sol";
import {ResolutionRouter} from "../src/ResolutionRouter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockGatewayWallet} from "./mocks/MockGatewayWallet.sol";

contract DocumentaryTradeEscrowFactoryTest is Test {
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0x5E11E7);
    address internal constant ARBITER = address(0xAAB1);
    address internal constant OPERATOR = address(0x0A11CE);
    uint256 internal constant BUYER_KEY = 0xB0B;
    uint256 internal constant SELLER_KEY = 0x5E11E7;
    uint256 internal constant RESOLVER_KEY = 0xAAB1;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant GATEWAY = 0x0077777d7EBA4688BDeF3E311b846F25870A19B9;

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

    function testRouterCanBeFrozenAsTheFactoryArbitrationAuthority() public {
        ResolutionRouter router = new ResolutionRouter();
        DocumentaryTradeEscrowFactory routerFactory = new DocumentaryTradeEscrowFactory(address(router), OPERATOR);

        bytes32 id = keccak256("router-backed-agreement");
        vm.prank(BUYER);
        address escrowAddress = routerFactory.createAgreement(id, SELLER, 20_000_000, block.timestamp + 7 days, 1 days, 1 days);

        assertEq(routerFactory.arbitrator(), address(router));
        assertEq(DocumentaryTradeEscrow(escrowAddress).arbitrationAddress(), address(router));
    }

    function testFactoryCreatedRouterEscrowResolvesThroughTheFrozenAuthority() public {
        address buyer = vm.addr(BUYER_KEY);
        address seller = vm.addr(SELLER_KEY);
        address resolver = vm.addr(RESOLVER_KEY);
        ResolutionRouter router = new ResolutionRouter();
        MockUSDC usdcImplementation = new MockUSDC();
        vm.etch(USDC, address(usdcImplementation).code);
        MockUSDC usdc = MockUSDC(USDC);
        usdc.setTransferFromResult(true);
        MockGatewayWallet gatewayImplementation = new MockGatewayWallet();
        vm.etch(GATEWAY, address(gatewayImplementation).code);
        DocumentaryTradeEscrowFactory routerFactory = new DocumentaryTradeEscrowFactory(address(router), OPERATOR);

        bytes32 id = keccak256("factory-router-e2e");
        vm.prank(buyer);
        address escrowAddress = routerFactory.createAgreement(id, seller, 1_000_000, block.timestamp + 7 days, 1 hours, 1 hours);
        DocumentaryTradeEscrow escrow = DocumentaryTradeEscrow(escrowAddress);

        DocumentaryTradeEscrow.Milestone[] memory milestones = new DocumentaryTradeEscrow.Milestone[](1);
        milestones[0] = DocumentaryTradeEscrow.Milestone("delivery", 10_000, 100, 50, 50);
        vm.prank(buyer);
        escrow.proposeMilestones(milestones);
        vm.prank(seller);
        escrow.approve();
        usdc.mint(buyer, 1_000_000);
        vm.prank(buyer);
        usdc.approve(escrowAddress, 1_000_000);
        vm.prank(buyer);
        escrow.depositUSDS();
        vm.prank(seller);
        escrow.triggerMilestone(0, keccak256("delivery-proof"));
        vm.prank(buyer);
        escrow.dispute(0);

        _resolve(router, escrowAddress, buyer, seller, resolver);

        assertEq(escrow.arbitrationAddress(), address(router));
        assertEq(uint8(escrow.milestoneStates(0)), uint8(DocumentaryTradeEscrow.MilestoneState.ARBITRATED));
        assertEq(escrow.settlementRecipient(0), seller);
        assertEq(escrow.settlementAmount(0), 1_000_000);
    }

    function _signature(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _resolve(ResolutionRouter router, address escrowAddress, address buyer, address seller, address resolver) internal {
        ResolutionRouter.ResolutionRequest memory request;
        request.escrow = escrowAddress;
        request.resolver = resolver;
        request.assignmentNonce = 1;
        request.assignmentExpiry = block.timestamp + 1 days;
        request.recipient = seller;
        request.decisionNonce = 1;
        request.decisionExpiry = block.timestamp + 1 hours;
        bytes32 caseId = router.getCaseId(escrowAddress, 0);
        bytes32 assignmentDigest = router.getAssignmentDigest(caseId, escrowAddress, 0, buyer, seller, resolver, 1, request.assignmentExpiry);
        bytes32 decisionDigest = router.getDecisionDigest(caseId, escrowAddress, 0, resolver, seller, 1, request.decisionExpiry, 1, request.assignmentExpiry);
        request.buyerSignature = _signature(BUYER_KEY, assignmentDigest);
        request.sellerSignature = _signature(SELLER_KEY, assignmentDigest);
        request.resolverAssignmentSignature = _signature(RESOLVER_KEY, assignmentDigest);
        request.resolverDecisionSignature = _signature(RESOLVER_KEY, decisionDigest);
        router.resolve(request);
    }
}
