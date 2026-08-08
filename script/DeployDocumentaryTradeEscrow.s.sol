// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DocumentaryTradeEscrow} from "../src/DocumentaryTradeEscrow.sol";

/// @notice Deploys a trade-specific escrow using addresses supplied as environment variables.
contract DeployDocumentaryTradeEscrow is Script {
    function run() external returns (DocumentaryTradeEscrow escrow) {
        address buyer = vm.envAddress("BUYER_ADDRESS");
        address seller = vm.envAddress("SELLER_ADDRESS");
        address arbitrator = vm.envAddress("ARBITRATION_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        uint256 totalUSDC = vm.envUint("TOTAL_USDC");
        uint256 negotiationExpiry = vm.envUint("NEGOTIATION_EXPIRY");
        uint256 commitmentWindow = vm.envUint("COMMITMENT_WINDOW");
        uint256 arbitrationTimeout = vm.envUint("ARBITRATION_TIMEOUT");

        vm.startBroadcast();
        escrow = new DocumentaryTradeEscrow(
            buyer, seller, arbitrator, operator, totalUSDC, negotiationExpiry, commitmentWindow, arbitrationTimeout
        );
        vm.stopBroadcast();
    }
}
