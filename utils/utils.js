const {
    ComputeBudgetProgram,
    SystemProgram,
    Transaction,
    LAMPORTS_PER_SOL,
    PublicKey,
    VersionedTransaction,
    Keypair
} = require("@solana/web3.js")
const {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    createCloseAccountInstruction
} = require("@solana/spl-token")
const axios = require("axios")
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const swap = require('./snipe/swapOnlyAmm.js')
const fs = require('fs')
const bs58 = require('bs58')
const path = require('path')
const crypto = require('crypto')
const qs = require('qs')
const https = require('follow-redirects').https
const {
    MarginfiClient
} = require('@mrgnlabs/marginfi-client-v2')

const WSOL_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112'
const USDC_TOKEN_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL_ADDRESS = 'So11111111111111111111111111111111111111111'
const SYMMETRY_AUTHORITY = 'BLBYiq48WcLQ5SxiftyKmPtmsZPUBEnDEjqEnKGAR4zx'

async function solTransfer(client_KeyPair, destination, amount, cm) {
    console.log('sending ' + (amount / LAMPORTS_PER_SOL) + ' from ' + client_KeyPair.publicKey.toBase58() + ' to ' + destination.toBase58())
    const solTransfer = new Transaction()
    //solTransfer.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300_000 }))
    //solTransfer.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }))
    try {

        solTransfer.add(
            SystemProgram.transfer({
                fromPubkey: client_KeyPair.publicKey,
                toPubkey: destination,
                lamports: amount 
            })
        )
        let blockhash = (await cm.connSync({ changeConn: true }).getLatestBlockhash('confirmed'))
        solTransfer.recentBlockhash = blockhash.blockhash
        solTransfer.sign(client_KeyPair)
        return await cm.connSync({ changeConn: true }).sendRawTransaction(solTransfer.serialize(), { skipPreflight: false, maxRetries: 0 })
    }
    catch (e) {
        console.log(e)
    }
   /* let txId = ''
    try {
        txId = await cm.connSync({ changeConn: true }).sendRawTransaction(solTransfer.serialize(), { skipPreflight: false, maxRetries: 0 })
        for (let i = 0; i < 3; i++) {
            cm.connSync({ changeConn: true }).sendRawTransaction(solTransfer.serialize(), { skipPreflight: false, maxRetries: 0 })
        }
    } catch (e) {
        console.log(e)
    }
    return { signature: txId, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight };
*/}

async function tokenTransfer(client_KeyPair, destination, mint, decimals, amount, cm) {
    console.log('sending ' + (amount / (10 ** decimals)) + ' from ' + client_KeyPair.publicKey.toBase58() + ' to ' + destination.toBase58())
    let tokenTransfer = new Transaction()
    tokenTransfer.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300_000 }))
    tokenTransfer.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    let dest_ATA = getAssociatedTokenAddressSync(mint, destination)
    let src_ATA = getAssociatedTokenAddressSync(mint, client_KeyPair.publicKey)

    if ((await cm.connSync({ changeConn: true }).getBalance(dest_ATA)) == 0) {
        tokenTransfer.add(createAssociatedTokenAccountInstruction(client_KeyPair.publicKey, dest_ATA, destination, mint))
    }
    tokenTransfer.add(createTransferCheckedInstruction(src_ATA, mint, dest_ATA, client_KeyPair.publicKey, amount, decimals))
    let blockhash = (await cm.connSync({ changeConn: true }).getLatestBlockhash('confirmed'))
    tokenTransfer.recentBlockhash = blockhash.blockhash
    tokenTransfer.sign(client_KeyPair)

    let txId = ''
    try {
        txId = await cm.connSync({ changeConn: true }).sendRawTransaction(tokenTransfer.serialize(), { skipPreflight: false, maxRetries: 0 })
        for (let i = 0; i < 3; i++) {
            cm.connSync({ changeConn: true }).sendRawTransaction(tokenTransfer.serialize(), { skipPreflight: false, maxRetries: 0 })
        }
    } catch (e) {
        console.log( e)
    }
    return { signature: txId, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight };

}

async function swapJupiter(inputToken, outputToken, inputAmount, slippageBps, userKeypair, cm) {

    let quoteResponse
    // while (!quoteResponse) {
    try {
        //  let sleep_time =
        //    await sleep(Math.floor(Math.random() * 30_000))
        quoteResponse = await axios.get(`https://quote-api.jup.ag/v6/quote?inputMint=${inputToken}&outputMint=${outputToken}&amount=${inputAmount}&slippageBps=${slippageBps}`)
    } catch (e) {
        console.log('get quote failed, retrying... ' + e)
        console.log('inputToken: ' + inputToken)
    }
    //}
    // console.log(quoteResponse.data)
    let swapTransaction = await axios.post('https://quote-api.jup.ag/v6/swap', {
        userPublicKey: userKeypair.publicKey.toBase58().toString(),
        quoteResponse: quoteResponse.data,
        // computeUnitPriceMicroLamports: 20
    }, {
        headers: {
            'Content-Type': 'application/json',
        }
    }).then((response) => {
        return response.data.swapTransaction
    })
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    let transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // sign the transaction
    let blockhash = (await cm.connSync({ changeConn: true }).getLatestBlockhash('confirmed'))
    transaction.recentBlockhash = blockhash.blockhash
    transaction.sign([userKeypair]);

    const rawTransaction = transaction.serialize()
    const txId = await cm.connSync({ changeConn: true }).sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        //maxRetries: 2
    });
    console.log(`wallet ${userKeypair.publicKey.toBase58().slice(0, 4)}...${userKeypair.publicKey.toBase58().slice(-4)} swapped ${inputToken} for ${outputToken}`)
    for (let i = 0; i < 3; i++) {
        try {
            cm.connSync({ changeConn: true }).sendRawTransaction(rawTransaction, {
                skipPreflight: false,
                //maxRetries: 2
            });
        } catch (e) {
            console.log('some error')
        }
    }

    return { signature: txId, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight };

}

async function swapRaydium(inputToken, inputTokenAmount, inputTokenDecimals, slippage, outputToken, outputDecimals, ammPool, wallet, cm) {
    /* console.log('source: ' + wallet.publicKey.toBase58())
    console.log('inputTokenAmount: ' + inputTokenAmount / LAMPORTS_PER_SOL)
    console.log('inputToken: '+inputToken)
     console.log('outputToken: '+outputToken)
     console.log('outputToken Decimals: '+outputDecimals)
     console.log('inputToken Decimals: '+inputTokenDecimals)
     console.log('slippage: '+slippage)
     console.log('ammId: '+ammPool)
    console.log('---------------------------------------------------------------------------')*/

    await swap.buy(inputToken, inputTokenAmount, inputTokenDecimals, slippage, outputToken, outputDecimals, ammPool, cm, wallet)
}


async function sol_checked(client_KeyPair, destination, amount, cm) {

    let begin_balance = await cm.connSync({ changeConn: true }).getBalance(destination)
    let response = await solTransfer(client_KeyPair, destination, amount, cm)
    let confirmed;

    do {
        try {
            await sleep(35_000)
            confirmed = (await cm.connSync({ changeConn: true }).confirmTransaction(response)).value.confirmationStatus
            console.log('confirmed status: '+confirmed)
        } catch (e) {
            if (await cm.connSync({ changeConn: true }).getBalance(destination) >= amount + begin_balance) {
                return;
            } else {
                response = await solTransfer(client_KeyPair, destination, amount, cm)
            }
        }
    } while (!confirmed)

}

async function token_checked(client_KeyPair, destination, token, decimals, amount, cm) {

    let begin_balance = await getTokenBalance(destination, token, cm)
    let response = await tokenTransfer(client_KeyPair, destination, token, decimals, amount, cm)
    let confirmed;
    do {
        try {
            await sleep(1_000)
            confirmed = (await cm.connSync({ changeConn: true }).confirmTransaction(response)).value.confirmationStatus
        } catch (e) {
            if ((await getTokenBalance(destination, token, cm)) >= amount + begin_balance) {
                return;
            } else {
                response = await tokenTransfer(client_KeyPair, destination, token, decimals, amount, cm)
            }
        }
    } while (!confirmed)
}

async function swapJupiter_checked(inputToken, outputToken, inputAmount, slippageBps, stagger, userKeypair, cm) {
    if (stagger > 0) {
        let sleep_time = Math.floor(stagger * Math.random()) * 1000
        console.log('sleeping: ' + sleep_time)
        await sleep(sleep_time);
    }
    let begin_balance = await getTokenBalance(userKeypair.publicKey, new PublicKey(outputToken), cm)
    let response
    while (!response) {
        try {
            response = await swapJupiter(inputToken, outputToken, inputAmount, slippageBps, userKeypair, cm)
        } catch (e) {
            console.log('swap Jupiter failed')
        }
    }

    let confirmed;
    do {
        try {
            await sleep(3_000)
            console.log('trying response: ' + response.signature)
            confirmed = (await cm.connSync({ changeConn: true }).confirmTransaction(response)).value.confirmationStatus
        } catch (e) {
            if ((await getTokenBalance(userKeypair.publicKey, new PublicKey(outputToken), cm)) != begin_balance) {
                return;
            } else {
                console.log('trying again ...' + e)
                response = await swapJupiter(inputToken, outputToken, inputAmount, slippageBps, userKeypair, cm)
            }
        }
    } while (!confirmed)
    console.log('swap success')
}

async function swapRaydium_checked(inputToken, inputTokenAmount, inputTokenDecimals, slippage, outputToken, outputDecimals, ammPool, stagger, wallet, cm) {
    if (stagger > 0) {
        await sleep(Math.floor(stagger * Math.random()) * 1000);
    }
    let begin_balance = await getTokenBalance(wallet.publicKey, new PublicKey(outputToken), cm)
    let response
    let i = 0
    while (!response) {
        try {
            i++
            console.log(wallet.publicKey.toBase58() + ' ' + i)
            response = await swapRaydium(inputToken, inputTokenAmount, inputTokenDecimals, slippage, outputToken, outputDecimals, ammPool, wallet, cm)
            await sleep(20_000)
        } catch (e) {
            console.log('swap Raydium failed')
            console.log(e)
        }
    }

    let confirmed;
    do {
        try {
            console.log('trying response: ' + response.signature)
            confirmed = (await cm.connSync({ changeConn: true }).confirmTransaction(response)).value.confirmationStatus
            await sleep(6_000)
        } catch (e) {
            if ((await getTokenBalance(wallet.publicKey, new PublicKey(outputToken))) != begin_balance, cm) {
                return;
            } else {
                console.log('trying again ...')
                response = await swapRaydium(inputToken, inputTokenAmount, inputTokenDecimals, outputToken, outputDecimals, ammPool, wallet, cm)
            }
        }
    } while (!confirmed)
    console.log('swap success')
}



async function getWalletInfo(rpc, walletPublickey) {

    let body = {
        "jsonrpc": "2.0",
        "id": "string",
        "method": "getAssetsByOwner",
        "params": {
            "ownerAddress": walletPublickey,
            "page": 1,
            "limit": 100,
            "sortBy": {
                "sortBy": "created",
                "sortDirection": "asc"
            },
            "options": {
                "showUnverifiedCollections": true,
                "showCollectionMetadata": false,
                "showGrandTotal": true,
                "showFungible": true,
                "showNativeBalance": true,
                "showInscription": false,
                "showZeroBalance": false
            }
        }
    }
    let response = await axios.post(rpc, body).then((response) => {
        response.data.result.publicKey = walletPublickey
        return response.data.result
    }).catch((e) => {
        console.log(e)
    })
    return response;
}

async function getTokenBalance(wallet, token, cm) {
    let tokenAccount = getAssociatedTokenAddressSync(token, wallet)
    let data = await cm.connSync({ changeConn: true }).getTokenAccountBalance(tokenAccount).catch((e) => { return 0 })

    return data?.value?.amount ? data.value.amount : 0
    /*
    try {
        let tokenAccount = getAssociatedTokenAddressSync(token, walletPublickey)
        let response = await cm.connSync({ changeConn: true }).getTokenAccountBalance(tokenAccount)
        return response?.value?.amount ? response.value.amount : 0
    } catch (e) {
        return 0;
    }
    */
}

async function getSolBalance(wallet, cm) {
    return cm.connSync({ changeConn: true }).getBalance(wallet)
}

async function getTokenBalanceWallet(wallet, token, cm) {
    let tokenAccount = getAssociatedTokenAddressSync(token, wallet)
    let data = await cm.connSync({ changeConn: true }).getTokenAccountBalance(tokenAccount)

    return data?.value?.amount ? { balance: data.value.amount, publicKey: wallet.toBase58() } : { balance: amount, publicKey: wallet.toBase58() }
    /*  let walletData = (await getWalletInfo(cm.connSync({ changeConn: true }).rpcEndpoint, walletPublickey.toBase58()))
          .items.filter((item) => {
              return item.id == token.toBase58()
          })
      let balance = walletData.length > 0 ? walletData[0].token_info.balance : 0
      return {
          balance,
          publicKey: walletPublickey.toBase58()
      } */
}

async function getSolBalanceWallet(wallet, cm) {
    let balance = await cm.connSync({ changeConn: true }).getBalance(wallet)
    return {
        balance,
        publicKey: wallet.toBase58()
    }
}


async function getSummary(cm, wallets) {
    let result = {
        sol_balance: 0,
        sol_balance_usd: 0,
        total_value: 0,
        sol_balance_lowest: Number.MAX_SAFE_INTEGER,
        tokens: []
    }
    let errors = 0
    await Promise.all(wallets.map((wallet) => {
        return getWalletInfo(cm.connSync({ changeConn: true }).rpcEndpoint, new PublicKey(wallet))
    }))
        .then((datum) => {
            for (let element of datum) {
                try {
                    result.sol_balance += element.nativeBalance.lamports
                    result.sol_balance_usd += element.nativeBalance.total_price
                    result.total_value += element.nativeBalance.total_price

                    if (result.sol_balance_lowest > element.nativeBalance.lamports) {
                        result.sol_balance_lowest = element.nativeBalance.lamports
                    }
                    for (let token of element.items) {
                        if (token.compression.compressed) {
                            continue;
                        }
                        if (token?.token_info?.price_info?.total_price) {
                            result.total_value += token.token_info.price_info.total_price
                        }
                        let index = result.tokens.findIndex(tok => tok.id == token.id)
                        if (index == -1) {
                            result.tokens.push(
                                {
                                    id: token.id,
                                    ticker: `${token.content.metadata.name}/${token.content.metadata.symbol}`,
                                    amount: token.token_info.balance,
                                    amountUi: (token.token_info.balance) / (10 ** token?.token_info.decimals),
                                    amount_usd: (token?.token_info?.price_info?.total_price)
                                }
                            )
                        } else {
                            result.tokens[index].amount += token.token_info.balance
                            result.tokens[index].amountUi += (token.token_info.balance) / (10 ** token?.token_info.decimals)
                            if (token?.token_info?.price_info?.total_price) {
                                result.tokens[index].amount_usd += token.token_info.price_info.total_price
                            }
                        }
                    }
                } catch (e) {
                    errors++
                }
            }
        })

    result.sol_balance = result.sol_balance / LAMPORTS_PER_SOL
    result.sol_balance_lowest = result.sol_balance_lowest / LAMPORTS_PER_SOL
    result.tokens.sort((a, b) => {
        return b?.amount_usd - a?.amount_usd
    })
    return { result, errors }
}

async function getAllData(cm, wallets) {
    let data = []
    await Promise.all(wallets.map((wallet) => {
        return getWalletInfo(cm.connSync({ changeConn: true }).rpcEndpoint, new PublicKey(wallet))
    })).then((datum) => {
        try {
            for (let element of datum) {
                let result = {
                    publicKey: element.publicKey,
                    sol_balance: element.nativeBalance.lamports / LAMPORTS_PER_SOL,
                    sol_balance_usd: element.nativeBalance.total_price,
                    tokens: []
                }
                for (let token of element.items) {
                    if (token.compression.compressed) {
                        continue;
                    }
                    result.tokens.push({
                        id: token.id,
                        ticker: `${token.content.metadata.name}/${token.content.metadata.symbol}`,
                        amount: token.token_info.balance,
                        amount_usd: (token.token_info?.price_info?.total_price)
                    })
                }
                data.push(result)
            }
        } catch (e) {
            console.log('error fetching wallet data :' + e)
        }
    })
    return data
}

async function getFormatedInputAmount(args, cm) {
    let inputAmount;

    if (args.values.inputToken == WSOL_TOKEN_ADDRESS || args.values.inputToken == SOL_ADDRESS) {
        inputAmount = args.values?.inputAmountRaw ? args.values.inputAmountRaw : args.values.inputAmountUi * LAMPORTS_PER_SOL
    } else {
        inputAmount = args.values?.inputAmountRaw ? args.values.inputAmountRaw : args.values.inputAmountUi * 10 ** (await cm.connSync({ changeConn: true }).getTokenSupply(new PublicKey(args.values.inputToken))).value.decimals
    }
    return inputAmount
}

async function closeTokenAccounts(tokens, wallet, cm) {
    let transaction = new Transaction()
    tokens.forEach((token) => {
        transaction.add(createCloseAccountInstruction(
            getAssociatedTokenAddressSync(new PublicKey(token.mint), wallet.publicKey),
            wallet.publicKey,
            wallet.publicKey
        ))
    })
    transaction.recentBlockhash = (await cm.connSync({ changeConn: true }).getLatestBlockhash('confirmed')).blockhash
    transaction.sign(wallet)
    for (let i = 0; i < 3; i++) {
        cm.connSync({ changeConn: true }).sendRawTransaction(transaction.serialize(), { skipPreflight: true })
    }
    console.log(`wallet ${wallet.publicKey.toBase58().slice(0, 4)}...${wallet.publicKey.toBase58().slice(-4)} closing ${tokens.length} accounts`)

}

function parseTime(input) {
    /**
     * returns time input in seconds
     */
    let hours = input.includes('h') ? input.indexOf('h') ? Number.parseInt(input.slice(0, input.indexOf('h'))) * 3600 : 0 : 0
    let minutes = input.includes('m') ? Number.parseInt(input.slice(input.indexOf('h') ? input.indexOf('h') + 1 : 0, input.indexOf('m'))) * 60 : 0
    let time = hours + minutes
    return time
}
/*
 async function swapPheonix(inputToken, outputToken, inputAmount, marketAddress, slippage, wallet, cm) {
    // accpet input token and output token and find market address if none, return invalid market
  

    const marketAccount = await connection.getAccountInfo(
        marketAddress,
        "confirmed"
    );
    if (!marketAccount) {
        throw Error(
            "Market account not found for address: " + marketAddress.toBase58()
        );
    }

    const client = await Phoenix.Client.createWithMarketAddresses(cm.connSync({changeConn:true}), [
        marketAddress,
    ]);

    const marketState = client.marketStates.get(marketAddress.toBase58());
    if (marketState === undefined) {
        throw Error("Market not found");
    }

    const side = Phoenix.Side.Bid;
    const inAmount = 1.7;
    const slippage = 0.008;
    console.log(
        side === Phoenix.Side.Ask ? "Selling" : "Market buy",
        inAmount,
        side === Phoenix.Side.Ask ? "SOL" : "USDC",
        "with",
        slippage * 100,
        "% slippage"
    );

    // Generate an IOC order packet
    const orderPacket = marketState.getSwapOrderPacket({
        side,
        inAmount,
        slippage,
    });
    // Generate a swap instruction from the order packet
    const swapIx = marketState.createSwapInstruction(orderPacket, trader.publicKey);
    // Create a transaction with the swap instruction

    const swapTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300_000 }))
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
        .add(createAssociatedTokenAccountIdempotentInstruction(trader.publicKey,))
        .add(createAssociatedTokenAccountIdempotentInstruction())
        .add(swapIx);

    const expectedOutAmount = client.getMarketExpectedOutAmount({
        marketAddress: marketAddress.toBase58(),
        side,
        inAmount,
    });
    console.log(
        "Expected out amount:",
        expectedOutAmount,
        side === Phoenix.Side.Ask ? "USDC" : "SOL"
    );

    const txId = await sendAndConfirmTransaction(connection, swapTx, [trader], {
        commitment: "confirmed",
        skipPreflight: true
    });
    console.log("Transaction ID:", txId);

    const txResult = await Phoenix.getPhoenixEventsFromTransactionSignature(
        connection,
        txId
    );

    if (txResult.txFailed) {
        console.log("Swap transaction failed");
        return;
    }

    const fillEvents = txResult.instructions[0];

    const summaryEvent = fillEvents.events[fillEvents.events.length - 1];
    if (!isPhoenixMarketEventFillSummary(summaryEvent)) {
        throw Error(`Unexpected event type: ${summaryEvent}`);
    }

    // This is pretty sketch
    const summary = summaryEvent.fields[0];

    if (side == Phoenix.Side.Bid) {
        console.log(
            "Filled",
            marketState.baseLotsToRawBaseUnits(Phoenix.toNum(summary.totalBaseLotsFilled)),
            "SOL"
        );
    } else {
        console.log(
            "Sold",
            inAmount,
            "SOL for",
            marketState.quoteLotsToQuoteUnits(Phoenix.toNum(summary.totalQuoteLotsFilled)),
            "USDC"
        );
    }

    const fees = marketState.quoteLotsToQuoteUnits(
        Phoenix.toNum(summary.totalFeeInQuoteLots)
    );
    console.log(`Paid ${fees} in fees`);
}
*/
const getMessageSignature = (path, request, secret, nonce) => {
    const message = qs.stringify(request);
    console.log(message)
    const secret_buffer = new Buffer(secret, 'base64');
    const hash = new crypto.createHash('sha256');
    const hmac = new crypto.createHmac('sha512', secret_buffer);
    const hash_digest = hash.update(nonce + message).digest('binary');
    const hmac_digest = hmac.update(path + hash_digest, 'binary').digest('base64');
    console.log(hmac_digest)
    return hmac_digest;
};

//krakenWithdrawl('5')
async function periodicKrakenWithdrawl(maxWallets, time, minAmount, maxAmount, apiPublic, apiPrivate) {

    /**
     * receives 
     *  -maxWallets -> all whitelisted wallets should be numbered incrementally starting from 1 - max
     *  -time -> the max time by whcih all wallets will have been funded (in XhYm)
     *  -minAmount -> minimum amount of SOL a wallet should receive (ie 0.45)
     *  -maxAmount -> max amount of SOL wallet should receive (ie 0.45)
     * 
     * - kraken api keys should be in .env file
     */

    for (let i = 1; i <= maxWallets; i++) {
        let nonce = Date.now()
        let amount = Math.floor(1000 * (Math.random() * (maxAmount - minAmount) + minAmount)) / 1000
        let data = {
            "nonce": nonce,
            "asset": "SOL",
            "key": i.toString(),
            "amount": amount.toString(),
            //"address": "bc1kar0ssrr7xf3vy5l6d3lydnwkre5og2zz3f5ldq"
        }
        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://api.kraken.com//0/private/Withdraw',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'API-Key': apiPublic,
                'API-Sign': getMessageSignature('/0/private/Withdraw', data, apiPrivate, nonce)
            },
            data: qs.stringify(data)
        };

        await axios(config)
            .then((response) => {
                console.log(JSON.stringify(response.data));
            })
            .catch((error) => {
                console.log(error);
            });
        console.log(`waiting ${time[i - 1] / 60} minutes`)
        await sleep(time[i - 1] * 1000)
    }

}
async function isMarginfiClientFunded(
    wallet,
    cm
) {

    const config = {
        environment: "production",
        programId: new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"),
        groupPk: new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8"),
        cluster: "mainnet",
    };


    const client = await MarginfiClient.fetch(
        config,
        { publicKey: wallet.publicKey },
        cm.connSync({ changeConn: true }),
        { readOnly: true, preloadedBankAddresses: [] }
    )


    const walletAccounts = await client.getMarginfiAccountsForAuthority(client.wallet.publicKey);

    return walletAccounts.length > 0
}


module.exports = {
    periodicKrakenWithdrawl,
    getAllData,
    getSummary,
    getSolBalance,
    getSolBalanceWallet,
    getTokenBalance,
    getTokenBalanceWallet,
    getWalletInfo,
    swapJupiter_checked,
    swapJupiter,
    swapRaydium_checked,
    isMarginfiClientFunded,
    sol_checked,
    solTransfer,
    token_checked,
    swapRaydium,
    closeTokenAccounts,
    getFormatedInputAmount,
    parseTime,
    USDC_TOKEN_ADDRESS,
    WSOL_TOKEN_ADDRESS,
    SOL_ADDRESS,
    SYMMETRY_AUTHORITY
}