"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TOKEN = exports.addLookupTableInfo = exports.makeTxVersion = exports.RAYDIUM_MAINNET_API = exports.ENDPOINT = exports.PROGRAMIDS = exports.connection = exports.wallet = exports.rpcToken = exports.rpcUrl = void 0;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
exports.rpcUrl = "https://mainnet.helius-rpc.com/?api-key=b2a68002-8a6c-402c-9866-9736a6fb891a";
exports.rpcToken = undefined;
exports.wallet = web3_js_1.Keypair.fromSecretKey(bs58_1.default.decode(''));
exports.connection = new web3_js_1.Connection(exports.rpcUrl);
exports.PROGRAMIDS = raydium_sdk_1.MAINNET_PROGRAM_ID;
exports.ENDPOINT = raydium_sdk_1.ENDPOINT;
exports.RAYDIUM_MAINNET_API = raydium_sdk_1.RAYDIUM_MAINNET;
exports.makeTxVersion = raydium_sdk_1.TxVersion.V0; // LEGACY
exports.addLookupTableInfo = raydium_sdk_1.LOOKUP_TABLE_CACHE; // only mainnet. other = undefined
exports.DEFAULT_TOKEN = {
    'WSOL': new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, new web3_js_1.PublicKey('So11111111111111111111111111111111111111112'), 9, 'WSOL', 'WSOL'),
    'USDC': new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, new web3_js_1.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 6, 'USDC', 'USDC'),
    'RAY': new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, new web3_js_1.PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'), 6, 'RAY', 'RAY'),
    'RAY_USDC-LP': new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, new web3_js_1.PublicKey('FGYXP4vBkMEtKhxrmEBcWN8VNmXX8qNgEJpENKDETZ4Y'), 6, 'RAY-USDC', 'RAY-USDC'),
};
