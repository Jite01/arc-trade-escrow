// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DocumentaryTradeEscrow} from "./DocumentaryTradeEscrow.sol";

/// @notice Minimal agreement registry and factory for one escrow per documentary trade.
/// @dev The escrow remains the source of truth for lifecycle and settlement state.
contract DocumentaryTradeEscrowFactory {
    struct Agreement {
        address escrow;
        address buyer;
        address seller;
        address arbitrator;
        uint256 createdAt;
    }

    error InvalidAddress();
    error InvalidAgreementId();
    error AgreementExists();
    error InvalidTerms();

    address public immutable arbitrator;
    address public immutable operator;
    address public immutable implementation;
    mapping(bytes32 => Agreement) private agreements;
    mapping(address => bytes32[]) private participantAgreementIds;

    event AgreementCreated(
        bytes32 indexed agreementId,
        address indexed escrow,
        address indexed buyer,
        address seller,
        address arbitrator,
        uint256 totalUSDC
    );

    constructor(address arbitrator_, address operator_) {
        if (arbitrator_ == address(0) || operator_ == address(0)) revert InvalidAddress();
        arbitrator = arbitrator_;
        operator = operator_;
        implementation = address(
            new DocumentaryTradeEscrow(address(1), address(2), arbitrator_, operator_, 1, block.timestamp + 365 days, 1, 1)
        );
    }

    function createAgreement(
        bytes32 agreementId,
        address seller,
        uint256 totalUSDC,
        uint256 negotiationExpiry,
        uint256 commitmentWindow,
        uint256 arbitrationTimeout
    ) external returns (address escrow) {
        if (agreementId == bytes32(0)) revert InvalidAgreementId();
        if (agreements[agreementId].escrow != address(0)) revert AgreementExists();
        if (seller == address(0) || seller == msg.sender) revert InvalidAddress();
        if (totalUSDC == 0 || negotiationExpiry <= block.timestamp || arbitrationTimeout == 0) {
            revert InvalidTerms();
        }

        escrow = _clone(implementation);
        DocumentaryTradeEscrow(escrow).initialize(
            msg.sender,
            seller,
            arbitrator,
            operator,
            totalUSDC,
            negotiationExpiry,
            commitmentWindow,
            arbitrationTimeout
        );
        agreements[agreementId] = Agreement(escrow, msg.sender, seller, arbitrator, block.timestamp);
        participantAgreementIds[msg.sender].push(agreementId);
        participantAgreementIds[seller].push(agreementId);
        emit AgreementCreated(agreementId, escrow, msg.sender, seller, arbitrator, totalUSDC);
    }

    function getAgreement(bytes32 agreementId) external view returns (Agreement memory) {
        return agreements[agreementId];
    }

    function agreementsOf(address participant) external view returns (bytes32[] memory) {
        return participantAgreementIds[participant];
    }

    function _clone(address target) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
            bytes20(target),
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly {
            instance := create(0, add(code, 0x20), mload(code))
        }
        if (instance == address(0)) revert InvalidAddress();
    }
}
