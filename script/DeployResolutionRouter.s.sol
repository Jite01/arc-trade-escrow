// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ResolutionRouter} from "../src/ResolutionRouter.sol";

contract DeployResolutionRouter is Script {
    function run() external returns (ResolutionRouter router) {
        vm.startBroadcast();
        router = new ResolutionRouter();
        vm.stopBroadcast();
    }
}
