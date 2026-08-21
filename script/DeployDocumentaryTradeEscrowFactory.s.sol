// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DocumentaryTradeEscrowFactory} from "../src/DocumentaryTradeEscrowFactory.sol";

contract DeployDocumentaryTradeEscrowFactory is Script {
    function run() external returns (DocumentaryTradeEscrowFactory factory) {
        address router = vm.envAddress("RESOLUTION_ROUTER_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        vm.startBroadcast();
        factory = new DocumentaryTradeEscrowFactory(router, operator);
        vm.stopBroadcast();
    }
}
