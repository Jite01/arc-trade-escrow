// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ResolutionRouter} from "../src/ResolutionRouter.sol";
import {DocumentaryTradeEscrow} from "../src/DocumentaryTradeEscrow.sol";
import {MockERC1271Signer} from "./mocks/MockERC1271Signer.sol";
import {MockResolutionEscrow} from "./mocks/MockResolutionEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockGatewayWallet} from "./mocks/MockGatewayWallet.sol";

contract ResolutionRouterTest is Test {
    uint256 internal constant BUYER_KEY = 0xB0B;
    uint256 internal constant SELLER_KEY = 0x5E11E7;
    uint256 internal constant RESOLVER_KEY = 0xAAB1;

    address internal buyer;
    address internal seller;
    address internal resolver;
    ResolutionRouter internal router;
    MockResolutionEscrow internal escrow;

    function setUp() public {
        buyer = vm.addr(BUYER_KEY);
        seller = vm.addr(SELLER_KEY);
        resolver = vm.addr(RESOLVER_KEY);
        router = new ResolutionRouter();
        escrow = new MockResolutionEscrow(buyer, seller, address(router));
    }

    function testEOAAssignmentAndDecisionResolveExactlyOnce() public {
        escrow.setDisputed(2);
        ResolutionRouter.ResolutionRequest memory request = _signedRequest(address(escrow), 2, seller);

        router.resolve(request);
        assertEq(escrow.recipients(2), seller);
        assertTrue(router.resolvedCases(router.getCaseId(address(escrow), 2)));

        vm.expectRevert(ResolutionRouter.CaseAlreadyResolved.selector);
        router.resolve(request);
    }

    function testCaseIdBindsEscrowAndConcurrentMilestones() public {
        MockResolutionEscrow second = new MockResolutionEscrow(buyer, seller, address(router));
        bytes32 firstMilestone = router.getCaseId(address(escrow), 0);
        bytes32 secondMilestone = router.getCaseId(address(escrow), 1);
        bytes32 secondEscrow = router.getCaseId(address(second), 0);
        assertTrue(firstMilestone != secondMilestone);
        assertTrue(firstMilestone != secondEscrow);
        assertTrue(secondMilestone != secondEscrow);

        escrow.setDisputed(0);
        escrow.setDisputed(1);
        router.resolve(_signedRequest(address(escrow), 0, buyer));
        router.resolve(_signedRequest(address(escrow), 1, seller));
        assertEq(escrow.recipients(0), buyer);
        assertEq(escrow.recipients(1), seller);
    }

    function testForceReleaseRaceMakesRouterResolutionInvalid() public {
        escrow.setDisputed(0);
        ResolutionRouter.ResolutionRequest memory request = _signedRequest(address(escrow), 0, seller);
        escrow.forceRelease(0);
        vm.expectRevert(ResolutionRouter.CaseNotDisputed.selector);
        router.resolve(request);
    }

    function testERC1271ResolverIsSupported() public {
        MockERC1271Signer smartResolver = new MockERC1271Signer();
        escrow = new MockResolutionEscrow(buyer, seller, address(router));
        escrow.setDisputed(0);

        ResolutionRouter.ResolutionRequest memory request =
            _unsignedRequest(address(escrow), 0, address(smartResolver), buyer);
        bytes32 assignmentDigest = router.getAssignmentDigest(
            router.getCaseId(address(escrow), 0),
            address(escrow),
            0,
            buyer,
            seller,
            address(smartResolver),
            request.assignmentNonce,
            request.assignmentExpiry
        );
        bytes32 decisionDigest = router.getDecisionDigest(
            router.getCaseId(address(escrow), 0),
            address(escrow),
            0,
            address(smartResolver),
            buyer,
            request.decisionNonce,
            request.decisionExpiry,
            request.assignmentNonce,
            request.assignmentExpiry
        );
        smartResolver.approve(assignmentDigest);
        smartResolver.approve(decisionDigest);
        request.buyerSignature = _signature(BUYER_KEY, assignmentDigest);
        request.sellerSignature = _signature(SELLER_KEY, assignmentDigest);
        router.resolve(request);
        assertEq(escrow.recipients(0), buyer);
    }

    function testERC1271BuyerAndSellerAreSupported() public {
        MockERC1271Signer smartBuyer = new MockERC1271Signer();
        MockERC1271Signer smartSeller = new MockERC1271Signer();
        buyer = address(smartBuyer);
        seller = address(smartSeller);
        escrow = new MockResolutionEscrow(buyer, seller, address(router));
        escrow.setDisputed(0);
        ResolutionRouter.ResolutionRequest memory request = _unsignedRequest(address(escrow), 0, resolver, buyer);
        bytes32 caseId = router.getCaseId(address(escrow), 0);
        bytes32 assignmentDigest = router.getAssignmentDigest(
            caseId, address(escrow), 0, buyer, seller, resolver, request.assignmentNonce, request.assignmentExpiry
        );
        bytes32 decisionDigest = router.getDecisionDigest(
            caseId,
            address(escrow),
            0,
            resolver,
            buyer,
            request.decisionNonce,
            request.decisionExpiry,
            request.assignmentNonce,
            request.assignmentExpiry
        );
        smartBuyer.approve(assignmentDigest);
        smartSeller.approve(assignmentDigest);
        request.resolverAssignmentSignature = _signature(RESOLVER_KEY, assignmentDigest);
        request.resolverDecisionSignature = _signature(RESOLVER_KEY, decisionDigest);
        router.resolve(request);
        assertEq(escrow.recipients(0), buyer);
    }

    function testRejectsWrongEscrowRouterBinding() public {
        MockResolutionEscrow wrongRouter = new MockResolutionEscrow(buyer, seller, address(0x1234));
        wrongRouter.setDisputed(0);
        ResolutionRouter.ResolutionRequest memory request = _signedRequest(address(wrongRouter), 0, seller);
        vm.expectRevert(ResolutionRouter.WrongArbitrationAddress.selector);
        router.resolve(request);
    }

    function testRejectsExpiredAndMismatchedDecision() public {
        escrow.setDisputed(0);
        ResolutionRouter.ResolutionRequest memory expired = _signedRequest(address(escrow), 0, seller);
        expired.assignmentExpiry = block.timestamp - 1;
        vm.expectRevert(ResolutionRouter.SignatureExpired.selector);
        router.resolve(expired);

        ResolutionRouter.ResolutionRequest memory request = _signedRequest(address(escrow), 0, seller);
        request.recipient = buyer;
        vm.expectRevert(ResolutionRouter.InvalidDecisionSignature.selector);
        router.resolve(request);
    }

    function _signedRequest(address target, uint256 index, address recipient)
        internal
        returns (ResolutionRouter.ResolutionRequest memory request)
    {
        request = _unsignedRequest(target, index, resolver, recipient);
        bytes32 assignmentDigest = router.getAssignmentDigest(
            router.getCaseId(target, index),
            target,
            index,
            buyer,
            seller,
            resolver,
            request.assignmentNonce,
            request.assignmentExpiry
        );
        bytes32 decisionDigest = router.getDecisionDigest(
            router.getCaseId(target, index),
            target,
            index,
            resolver,
            recipient,
            request.decisionNonce,
            request.decisionExpiry,
            request.assignmentNonce,
            request.assignmentExpiry
        );
        request.buyerSignature = _signature(BUYER_KEY, assignmentDigest);
        request.sellerSignature = _signature(SELLER_KEY, assignmentDigest);
        request.resolverAssignmentSignature = _signature(RESOLVER_KEY, assignmentDigest);
        request.resolverDecisionSignature = _signature(RESOLVER_KEY, decisionDigest);
    }

    function _unsignedRequest(address target, uint256 index, address requestResolver, address recipient)
        internal
        view
        returns (ResolutionRouter.ResolutionRequest memory request)
    {
        request.escrow = target;
        request.milestoneIndex = index;
        request.resolver = requestResolver;
        request.assignmentNonce = 7;
        request.assignmentExpiry = block.timestamp + 1 days;
        request.recipient = recipient;
        request.decisionNonce = 11;
        request.decisionExpiry = block.timestamp + 1 hours;
    }

    function _signature(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}

contract ResolutionRouterEscrowIntegrationTest is Test {
    uint256 internal constant BUYER_KEY = 0xB0B;
    uint256 internal constant SELLER_KEY = 0x5E11E7;
    uint256 internal constant RESOLVER_KEY = 0xAAB1;
    address internal constant GATEWAY = 0x0077777d7EBA4688BDeF3E311b846F25870A19B9;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;

    address internal buyer;
    address internal seller;
    address internal resolver;
    ResolutionRouter internal router;
    DocumentaryTradeEscrow internal escrow;
    MockUSDC internal usdc;

    function setUp() public {
        buyer = vm.addr(BUYER_KEY);
        seller = vm.addr(SELLER_KEY);
        resolver = vm.addr(RESOLVER_KEY);
        router = new ResolutionRouter();
        MockUSDC usdcImplementation = new MockUSDC();
        vm.etch(USDC, address(usdcImplementation).code);
        usdc = MockUSDC(USDC);
        usdc.setTransferFromResult(true);
        MockGatewayWallet gatewayImplementation = new MockGatewayWallet();
        vm.etch(GATEWAY, address(gatewayImplementation).code);
        escrow = new DocumentaryTradeEscrow(
            buyer, seller, address(router), address(0xA11CE), 1_000_000, block.timestamp + 7 days, 1 hours, 500
        );
    }

    function testRouterCallsUnmodifiedEscrowAndRecordsExactSettlement() public {
        _activate(1);
        vm.prank(seller);
        escrow.triggerMilestone(0, keccak256("documents"));
        vm.prank(buyer);
        escrow.dispute(0);

        ResolutionRouter.ResolutionRequest memory request = _signedRequest(0, seller);
        router.resolve(request);

        assertEq(uint8(escrow.milestoneStates(0)), uint8(DocumentaryTradeEscrow.MilestoneState.ARBITRATED));
        assertEq(escrow.settlementRecipient(0), seller);
        assertEq(escrow.settlementAmount(0), 1_000_000);
    }

    function testConcurrentDisputesResolveByCaseNotCurrentIndex() public {
        _activate(2);
        vm.startPrank(seller);
        escrow.triggerMilestone(0, keccak256("documents-0"));
        vm.stopPrank();
        vm.prank(buyer);
        escrow.dispute(0);
        vm.prank(seller);
        escrow.triggerMilestone(1, keccak256("documents-1"));
        vm.prank(buyer);
        escrow.dispute(1);

        router.resolve(_signedRequest(1, seller));
        router.resolve(_signedRequest(0, buyer));
        assertEq(escrow.settlementRecipient(0), buyer);
        assertEq(escrow.settlementRecipient(1), seller);
    }

    function testForceReleaseWinsRaceAfterTimeout() public {
        _activate(1);
        vm.prank(seller);
        escrow.triggerMilestone(0, keccak256("documents"));
        vm.prank(buyer);
        escrow.dispute(0);
        ResolutionRouter.ResolutionRequest memory request = _signedRequest(0, seller);
        vm.warp(block.timestamp + 501);
        vm.prank(seller);
        escrow.forceRelease(0);
        vm.expectRevert(ResolutionRouter.CaseNotDisputed.selector);
        router.resolve(request);
    }

    function _activate(uint256 count) internal {
        DocumentaryTradeEscrow.Milestone[] memory milestones = new DocumentaryTradeEscrow.Milestone[](count);
        for (uint256 i; i < count; ++i) {
            milestones[i] = DocumentaryTradeEscrow.Milestone("shipment", uint16(10_000 / count), 100, 50, 50);
        }
        if (count == 2) milestones[1].basisPoints = 5_000;
        vm.prank(buyer);
        escrow.proposeMilestones(milestones);
        vm.prank(seller);
        escrow.approve();
        usdc.mint(buyer, 1_000_000);
        vm.prank(buyer);
        usdc.approve(address(escrow), 1_000_000);
        vm.prank(buyer);
        escrow.depositUSDS();
    }

    function _signedRequest(uint256 index, address recipient)
        internal
        returns (ResolutionRouter.ResolutionRequest memory request)
    {
        request.escrow = address(escrow);
        request.milestoneIndex = index;
        request.resolver = resolver;
        request.assignmentNonce = 1;
        request.assignmentExpiry = block.timestamp + 1 days;
        request.recipient = recipient;
        request.decisionNonce = 1;
        request.decisionExpiry = block.timestamp + 1 hours;
        bytes32 caseId = router.getCaseId(address(escrow), index);
        bytes32 assignmentDigest = router.getAssignmentDigest(
            caseId, address(escrow), index, buyer, seller, resolver, 1, request.assignmentExpiry
        );
        bytes32 decisionDigest = router.getDecisionDigest(
            caseId, address(escrow), index, resolver, recipient, 1, request.decisionExpiry, 1, request.assignmentExpiry
        );
        request.buyerSignature = _signature(BUYER_KEY, assignmentDigest);
        request.sellerSignature = _signature(SELLER_KEY, assignmentDigest);
        request.resolverAssignmentSignature = _signature(RESOLVER_KEY, assignmentDigest);
        request.resolverDecisionSignature = _signature(RESOLVER_KEY, decisionDigest);
    }

    function _signature(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
