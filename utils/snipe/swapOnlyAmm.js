"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buy = void 0;
const assert_1 = __importDefault(require("assert"));
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const formatAmmKeysById_1 = require("./formatAmmKeysById.js");
const util_1 = require("./util.cjs");
function swapOnlyAmm(input, inputToken, inputAmount, wallet, cm) {
    return __awaiter(this, void 0, void 0, function* () {
        // -------- pre-action: get pool info --------
        const targetPoolInfo = yield (0, formatAmmKeysById_1.formatAmmKeysById)(input.targetPool, cm);
        (0, assert_1.default)(targetPoolInfo, 'cannot find the target pool');
        const poolKeys = (0, raydium_sdk_1.jsonInfo2PoolKeys)(targetPoolInfo);
        // -------- step 1: coumpute amount out --------
        const { amountOut, minAmountOut } = raydium_sdk_1.Liquidity.computeAmountOut({
            poolKeys: poolKeys,
            poolInfo: yield raydium_sdk_1.Liquidity.fetchInfo({ connection: cm.connSync({ changeConn: true }), poolKeys }),
            amountIn: input.inputTokenAmount,
            currencyOut: input.outputToken,
            slippage: input.slippage,
        });
        // -------- step 2: create instructions by SDK function --------
        const { innerTransactions } = yield raydium_sdk_1.Liquidity.makeSwapInstructionSimple({
            connection: cm.connSync({ changeConn: true }),
            poolKeys,
            userKeys: {
                tokenAccounts: input.walletTokenAccounts,
                owner: input.wallet.publicKey,
            },
            amountIn: input.inputTokenAmount,
            amountOut: minAmountOut,
            fixedSide: 'in',
            makeTxVersion: raydium_sdk_1.TxVersion.V0,
        });
        // console.log('amountOut:', amountOut.toFixed(), '  minAmountOut: ', minAmountOut.toFixed());
        return { txids: yield (0, util_1.buildAndSendTx)(innerTransactions, cm.connSync({ changeConn: true }), wallet, inputToken, inputAmount, { skipPreFlight: true, maxRetries: 0 }) }; //TODO ??? token amount
    });
}
function buy(inToken, inTokenAmount, inTokenDecimals, user_slippage, outputTokenAddress, outputDecimals, targetPool, cm, wallet) {
    return __awaiter(this, void 0, void 0, function* () {
        const inputToken = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, inToken, inTokenDecimals); // USDC
        const outputToken = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, outputTokenAddress, outputDecimals); // RAY
        //const targetPool =  // USDC-RAY pool
        const inputTokenAmount = new raydium_sdk_1.TokenAmount(inputToken, inTokenAmount);
        const slippage = new raydium_sdk_1.Percent(user_slippage, 100);
        const walletTokenAccounts = yield (0, util_1.getWalletTokenAccount)(cm.connSync({ changeConn: true }), wallet.publicKey);
        return swapOnlyAmm({
            outputToken,
            targetPool,
            inputTokenAmount,
            slippage,
            walletTokenAccounts,
            wallet: wallet,
        }, inToken, inTokenAmount, wallet, cm);
    });
}
exports.buy = buy;
//buy(new PublicKey('9u9uLmK2CdJ9oNKrW8dFRFfSs5FSKW5n9EErPHKcoTVt'), 6, '7mwpWmJFD5xoDXuSRFFafwE5kGaRCB2BX8EfmTZWr9UK')
