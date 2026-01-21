#!/usr/bin/env node
/*
    spider down SOL/SPL to multiple accounts to ape + exit large positions in low liquidity coins
    creates wallets in levels and distributes from level to level in order to obfuscate source of funds 

    main uses
    - sybils for airdrop
    - obfuscating large positions in low cap spl tokens
*/
const {
    PublicKey,
    Keypair,
    LAMPORTS_PER_SOL,
    Transaction
} = require('@solana/web3.js')
const { ConnectionManager } = require('@solworks/soltoolkit-sdk')
const fs = require('fs')
const {
    sol_checked,
    solTransfer,
    swapJupiter_checked,
    swapJupiter,
    swapRaydium_checked,
    token_checked,
    getSolBalanceWallet,
    getTokenBalanceWallet,
    getSummary,
    getAllData,
    getWalletInfo,
    getFormatedInputAmount,
    closeTokenAccounts,
    periodicKrakenWithdrawl,
    parseTime,
    USDC_TOKEN_ADDRESS,
    WSOL_TOKEN_ADDRESS,
    SOL_ADDRESS,
    SYMMETRY_AUTHORITY,
    isMarginfiClientFunded
} = require('./utils/utils.js')
const bs58 = require('bs58')
const { parseArgs } = require("node:util");
const cla = require('./utils/cla.js')
const path = require('path')
const readline = require('readline')
const {
    TOKEN_PROGRAM_ID,
    AccountLayout,
} = require('@solana/spl-token')
require('dotenv').config()

async function handleMakeWallets(dir, depth, legs, seeds, iter) {

    for (let element of seeds) {
        if (depth == iter) {
            return [];
        }
        let keys = []
        for (let i = 0; i < legs; i++) {
            keys.push(Keypair.generate())
        }
        handleMakeWallets(dir, depth, legs, keys, iter + 1)
        let pkey = []
        for (let key of Object.keys(element.secretKey)) {
            pkey.push(element.secretKey[key])
        }
        pkey = new Uint8Array(pkey)
        if (iter == depth - 1) {
            if (!fs.existsSync(path.join(dir, 'Level_CLIENTS'))) {
                fs.mkdirSync(path.join(dir, 'Level_CLIENTS'))
            }
        } else if (!fs.existsSync(path.join(dir, `Level_${iter + 1}`))) {
            fs.mkdirSync(path.join(dir, `Level_${iter + 1}`))
        }
        iter == depth - 1 ? fs.writeFileSync(path.join(dir, `Level_CLIENTS/${element.publicKey}.json`), JSON.stringify(bs58.encode(pkey))) : fs.writeFileSync(path.join(dir, `Level_${iter + 1}/${element.publicKey}.json`), JSON.stringify(bs58.encode(pkey)))
        console.log('GENERATE KEYFILE ' + `.${path.join(dir, `Level_${iter + 1}/${element.publicKey}.json`)}`)
    }
}

async function handleDistribute(dir, token, amount, cm) {

    let folders = fs.readdirSync(dir)
    folders = folders.sort((a, b) => {
        return Number.parseInt(a.split('_')[1]) - Number.parseInt(b.split('_')[1])
    })

    // get total balance of specified token
    let lot_size = fs.readdirSync(path.join(dir, fs.readdirSync(dir)[1])).length / fs.readdirSync(path.join(dir, fs.readdirSync(dir)[0])).length
    let decimals = token == SOL_ADDRESS ? 9 : (await cm.connSync({ changeConn: true }).getTokenSupply(new PublicKey(token))).value.decimals

    for (let i = 0; i < folders.length - 1; i++) {
        //sned to lot size in element++
        let level = fs.readdirSync(path.join(dir, `${folders[i]}`))

        for (let j = 0; j < level.length; j++) {
            //sned 
            let wallet_kp = Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `${folders[i]}/${level[j]}`)))))
            let next_level = fs.readdirSync(path.join(dir, `${folders[i + 1]}`))
            let work = []
            for (let k = lot_size * j; k < lot_size * j + lot_size; k++) {
                let destination = Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `${folders[i + 1]}/${next_level[k]}`))))).publicKey
                if (token == SOL_ADDRESS) {
                    //sol transfer
                    let sned_amount = Math.floor(amount / lot_size ** (i + 1)) - 2 * (await cm.connSync({ changeConn: true }).getMinimumBalanceForRentExemption(16))
                    work.push(sol_checked(wallet_kp, destination, sned_amount, cm))
                } else {
                    //token transfer 
                    work.push(token_checked(wallet_kp, destination, new PublicKey(token), decimals, Math.floor(amount / lot_size ** (i + 1)), cm))
                }
            }
            await Promise.all(work)
        }
    }
}

async function handleTradeJupiter(dir, inputToken, outputToken, inputAmount, slippage, stagger, wallets, cm) {
    wallets = await Promise.all(
        inputToken == WSOL_TOKEN_ADDRESS ?
            wallets.map(async (wallet) => {
                return getSolBalanceWallet(new PublicKey(wallet.slice(0, wallet.length - 5)), cm)  //solBalanceWallet
            }) : wallets.map(async (wallet) => {
                return getTokenBalanceWallet(new PublicKey(wallet.slice(0, wallet.length - 5)), new PublicKey(inputToken), cm)
            })
    )

    let work = []
    wallets.forEach((wallet) => {
        let amount = inputAmount?.fraction ? Math.floor(inputAmount.fraction * wallet.balance) : inputAmount.amount
        if (inputToken == WSOL_TOKEN_ADDRESS) {
            amount = (wallet.balance - amount) > 0.01 * LAMPORTS_PER_SOL ? amount : wallet.balance - 0.01 * LAMPORTS_PER_SOL
        }
        if (amount > 0) {
        
            work.push(swapJupiter_checked(inputToken, outputToken, amount, slippage, stagger, Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `Level_CLIENTS/${wallet.publicKey}.json`))))), cm))
        } else {
           // console.log('wallet: ' + wallet.publicKey + ' - broke')
        }
    })
    await Promise.all(work)
}


async function handleTradeRaydium(dir, inputToken, inputAmount, slippage, outputToken, ammPool, stagger, wallets, cm) {
    wallets = await Promise.all(
        inputToken.toBase58() == WSOL_TOKEN_ADDRESS ?
            wallets.map(async (wallet) => {
                return getSolBalanceWallet(new PublicKey(wallet.slice(0, wallet.length - 5)), cm)  //solBalanceWallet
            }) : wallets.map(async (wallet) => {
                return getTokenBalanceWallet(new PublicKey(wallet.slice(0, wallet.length - 5)), inputToken, cm)
            })
    )
    let inputTokenDecimals = (await cm.connSync({ changeConn: true }).getTokenSupply(inputToken)).value.decimals
    let outputDecimals = (await cm.connSync({ changeConn: true }).getTokenSupply(outputToken)).value.decimals

    let work = []
    wallets.forEach((wallet) => {
        let amount = inputAmount?.fraction ? Math.floor(inputAmount.fraction * wallet.balance) : inputAmount.amount
        if (inputToken == WSOL_TOKEN_ADDRESS) {
            amount = (wallet.balance - amount) > 0.01 * LAMPORTS_PER_SOL ? amount : wallet.balance - 0.01 * LAMPORTS_PER_SOL
        }
        if (amount > 0) {
            work.push(swapRaydium_checked(inputToken, amount, inputTokenDecimals, slippage, outputToken, outputDecimals, ammPool, stagger, Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `Level_CLIENTS/${wallet.publicKey}.json`))))), cm))
        }

    })
    await Promise.all(work)
}

async function handleDumpAll(dir, outputToken, slippage, helius_cm, other_cm) {
    let wallets = fs.readdirSync(path.join(dir, 'Level_CLIENTS'))
    for (let wallet of wallets) {
        let wallet_keypair = Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `Level_CLIENTS/${wallet}`)))))
        await getWalletInfo(helius_cm.connSync({ changeConn: true }).rpcEndpoint, wallet.slice(0, wallet.length - 5))
            .then(async (data) => {
                for (let token of data.items) {
                    //exclude symmetry tokens
                    //ie tokenowner != whatever

                    // console.log(data)
                    try {
                        if (!token.compression.compressed && token?.authorities[0]?.address != SYMMETRY_AUTHORITY) {

                            await swapJupiter(token.id, outputToken, token.token_info.balance, slippage, wallet_keypair, other_cm)
                            console.log('done')
                            //  await sleep(10000)
                        }
                    } catch (e) {
                        console.log(e)
                    }
                }

            })
    }
}

async function handleSummary(cm, dir) {
    let wallets = fs.readdirSync(dir).map((wallet) => { return wallet.slice(0, wallet.length - 5) })
    let tots = await getSummary(cm, wallets)
    console.log(tots.result)
    console.log(`${tots.errors} ERRORS`)
}


async function handleWriteAll(dir, outdir, cm) {
    let result = {}
    for (let level of fs.readdirSync(dir)) {
        let wallets = fs.readdirSync(path.join(dir, level)).map((wallet) => { return wallet.slice(0, wallet.length - 5) })
        result[`${path.basename(level)}`] = (await getAllData(cm, wallets)).sort((a, b) => {
            return b.sol_balance - a.sol_balance
        })
    }
    fs.writeFileSync(outdir, JSON.stringify(result))
}


function handleLots(dir, batch, outdir) {
    let wallets = fs.readdirSync(dir)
    let lots = []
    while (wallets.length != 0) {
        let group = []
        for (let i = 0; i < batch; i++) {
            try {
                let removedElement = wallets.splice((Math.floor(Math.random() * wallets.length)), 1)[0];
                group.push({
                    pK: JSON.parse(fs.readFileSync(path.join(dir, removedElement))),
                    done: false,
                    notes: ""
                })
            } catch (e) {
                break;
            }
        }
        lots.push(group)
    }
    fs.writeFileSync(outdir, JSON.stringify(lots))
}
async function handleCloseTokenAccounts(dir, cm) {

    let wallets = fs.readdirSync(path.join(dir, 'Level_CLIENTS'))
    let count = 0
    for (let wallet of wallets) {
        let res = await cm.connSync({ changeConn: true }).getTokenAccountsByOwner(new PublicKey(wallet.slice(0, -5)), { programId: TOKEN_PROGRAM_ID })
        let tokens = []
        res.value.forEach((item) => {
            let accountInfo = AccountLayout.decode(item.account.data)
            if (accountInfo.amount == 0)
                tokens.push({ mint: accountInfo.mint, amount: accountInfo.amount })
        })
        if (tokens.length > 0)
            try {
                count++
                console.log(count)
                closeTokenAccounts(tokens, Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `Level_CLIENTS/${wallet}`))))), cm)
            } catch (e) {
                console.log('closeTOken Accounts: bunk')
            }
    }
}

async function handleSendTo(inputToken, inputAmount, destination, level, dir, cm) {
    let wallets = fs.readdirSync(path.join(dir, `Level_${level}`))
    wallets = await Promise.all(
        inputToken == SOL_ADDRESS ?
            wallets.map(async (wallet) => {
                return getSolBalanceWallet(new PublicKey(wallet.slice(0, wallet.length - 5)), cm)  //solBalanceWallet
            }) : wallets.map(async (wallet) => {
                return getTokenBalanceWallet(new PublicKey(wallet.slice(0, wallet.length - 5)), new PublicKey(inputToken), cm)
            })
    )
    let work = []
    wallets.forEach(async (wallet) => {
        let amount = inputAmount?.fraction ? Math.floor(inputAmount.fraction * wallet.balance) : inputAmount.amount
        if (inputToken == SOL_ADDRESS) {
            if (amount > 0)
                work.push(solTransfer(Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `Level_${level}/${wallet.publicKey}.json`))))), new PublicKey(destination), amount, cm))
        } else {
            work.push(token_checked(Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(dir, `Level_${level}/${wallet.publicKey}.json`))))), new PublicKey(destination), inputToken, decimals, amount, cm))
        }
    })
    await Promise.all(work)
}

async function handleAllKeys(level, outdir, dir) {
    let files = fs.readdirSync(path.join(dir, `Level_${level}`))
    let writeStream = fs.createWriteStream(outdir)
    files.forEach((file => {

        let pk = JSON.parse(fs.readFileSync(path.join(path.join(dir, `Level_${level}`), file)))
        let pubK = Keypair.fromSecretKey(bs58.decode(pk)).publicKey.toBase58()

        writeStream.write(`${pubK}\n`)
    }))
}

async function handleSybilState(outdir, dir, cm) {
    let files = fs.readdirSync(path.join(dir, `Level_CLIENTS`))
    let writeStream = fs.createWriteStream(outdir)
    console.log(cm.connSync({ changeConn: true }).rpcEndpoint)
    for (let file of files) {

        let pk = JSON.parse(fs.readFileSync(path.join(path.join(dir, `Level_CLIENTS`), file)))
        let keypair = Keypair.fromSecretKey(bs58.decode(pk))
        //below are filter conditions (mrgn, symetyr)

        //check mrgn
        // if(await isMarginfiClientFunded(keypair,cm))
        //   writeStream.write(`${pk}\n`)
        //check symetry 
        let info = await getWalletInfo(cm.connSync({ changeConn: true }).rpcEndpoint, keypair.publicKey.toBase58())
        for (let element of info.items) {
            for (let authorities of element.authorities) {
                if (authorities.address == SYMMETRY_AUTHORITY) {
                    writeStream.write(`${pk}\n`)
                }
            }
        }

    }
}

async function initConnection(type) {
    let endpoints;
    switch (type) {
        case 'helius': {
            endpoints = JSON.parse(fs.readFileSync(path.join(__dirname, './utils/rpcs/helius_rpc.json')))
            break;
        }
        case 'not-helius': {
            endpoints = JSON.parse(fs.readFileSync(path.join(__dirname, './utils/rpcs/other_rpc.json')))
            break;
        }
        case 'all': {
            endpoints = JSON.parse(fs.readFileSync(path.join(__dirname, './utils/rpcs/all_rpc.json')))
            break;
        }
    }

    return await ConnectionManager.getInstance({
        commitment: 'confirmed',
        endpoints: endpoints,
        mode: "random",
        network: "mainnet-beta"
    })
}



main()
async function main() {

    let args = parseArgs(cla);
    if (!args.positionals[0]) {
        console.log('command requires a target folder')
        return;
    }

    switch (process.argv[2]) {
        case '-mW':
        case '--makeWallets': {
            /**
             * description
             * - creates a folder in current directory ex.
             *                    [wallet1] <-------------------- (./yourfolder/LEVEL_1)
             *              [[wallet2],[wallet3]] <-------------- (./yourfolder/LEVEL_2)
             *    [[wallet4],[wallet5],[wallet6],[wallet7]] <---- (./yourfolder/LEVEL_CLIENTS)
             * 
             *  where the -legs flag sets the number of wallets per level (ie # of wallets in Level = Level^legs) and the -depth flag is the number of levels.
             *  The last level is always called LEVEL_CLIENTS. this is the level that will perform swaps 
             * 
             * short
             *  - ms
             * 
             * options
             *  - dir
             *  - depth:(required) how many levels to create
             *  - legs:(required) how many wallets each newly created wallet will send tokens to
             *  - seed:(required) the initial wallet that will seed other wallets with tokens
             * 
             * usage 
             *  - ex. -mW ./my_wallets --depth 2 -- legs 4 ./aALan6kZ38iu3cMZVZzt63XCJ6fNrKfRZFpcVXDRkMX.json
             *      the above command creates a folder called my_wallets in the current working directory and creates 4 different levels with an increasing
             *      number of wallets
             *  
             */
            if (args.values.depth && args.values.legs && args.values.seed) {
                //if dir exists, exit with error, otherwise proceed
                if (fs.existsSync(args.values.out)) {
                    console.error(`${args.positionals[0]} folder already exists. dont want to overwrite it. rename the existing folder or choose a new name`)
                    break;
                } else {
                    fs.mkdirSync(args.positionals[0])
                }
                handleMakeWallets(args.positionals[0], Number.parseInt(args.values.depth), Number.parseInt(args.values.legs), [Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(args.values.seed))))], 0)
            } else {
                console.log('missing arguments')
            }
            break;
        }
        case '-dT':
        case '--distributeToken': {
            /**
             * description
             * distributes tokens (SOL or SPL) from the seed wallet (the wallet in the LEVEL_1 folder) to the wallets in the LEVEL_CLIENTS folder
             * 
             * short
             *  - dT
             * 
             * options
             *  - inputToken:(required) the token to send. valid arguments are sol, or any SPL token address (eg. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
             *  - inputAmountRaw:(*) the raw input amount (eg --inputAmount 1000000000 --> distribute 1 SOL)
             *  - inputAmountUi:(*) the raw input amount divided by the number of decimals (eg --inputAmount 1 --> distribute 1 SOL)
             *  
             *     either inputAmoutRaw or inputAmountUi must be present 
             * 
             * usage 
             * ex.) -dT ./my_wallets --inputToken wsol --inputAmountRaw 500000000
             *         - this command transfers 0.5 WSOL from seed wallet to wallets in LEVEL_CLIENTS folder
             * ex.) -dT ./my_wallets --inputToken EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --inputAmountUi 100 
             *         - this command transfers 100 USDC from seed wallet to wallets in LEVEL_CLIENTS folder
             */

            let seed = fs.readdirSync(path.join(args.positionals[0], 'Level_1'))[0]
            let seedWallet = Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(path.join(args.positionals[0], `Level_1/${seed}`)))))
            if (args.values?.inputToken && (args.values?.inputAmountRaw || args.values?.inputAmountUi)) {
                try {
                    let all_cm = await initConnection('all')
                    args.values.inputToken = (args.values.inputToken.toLowerCase() == 'sol') ? SOL_ADDRESS : args.values.inputToken
                    let inputAmount
                    if (args.values?.inputAmountRaw == 'all' || args.values?.inputAmountUi == 'all') {
                        inputAmount = args.values.inputToken == SOL_ADDRESS ? (await getSolBalanceWallet(seedWallet.publicKey, all_cm)).balance - 0.01 * LAMPORTS_PER_SOL : (await getTokenBalanceWallet(seedWallet.publicKey, new PublicKey(args.values.inputToken), all_cm)).balance
                    } else {
                        inputAmount = await getFormatedInputAmount(args, all_cm)
                    }
                    await handleDistribute(args.positionals[0], args.values.inputToken, inputAmount, all_cm)
                } catch (e) {
                    console.log(e)
                }
            } else {
                console.log('missing arguments')
            }
            break;
        }
        case '-sJ':
        case '--swapJupiter': {
            /**
             * description
             * performs a swap on jupiter
             * 
             * short
             *  -sJ
             * 
             * options
             *  - inputToken:(required) the input token to the swap. valid arguments are sol, wsol, or any SPL token address (eg. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
             *  - outputToken:(required) the output token from the swap. valid arguments are sol, wsol, or any SPL token address (eg. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
             *  - slippage:(optional, default 0.5%) the max slippage for the transaction. valid inputs are integers from 0 - 50 (0% - 50%)
             *  - inputAmountRaw:(*) the raw input amount (eg --inputAmount 1000000000 --> swap 1 SOL
             *  - inputAmountUi:(*) the raw input amount divided by 10 ^ the number of decimals (eg --inputAmount 1 --> distribute 1 SOL)
             *  - fraction:(*) wil swap a fraction of the total input amount. valid inputs range from (0 - 1)  (eg --fraction 0.5 --> sell half of balance)
             * 
             *  usage
             *  ex) -sJ ./my_wallets --inputToken wsol --outputToken EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --inputAmountUi 10 --slippage 100
             */

            //TODO filter out all symmetry owned LP tokens 
            //create function to read current state of sybil network
            /*
                ie. marginfi {
                        totalWallets: X,
                        valueLocked: Y
                        wallets: [

                        ]
                }
                -ss
                --sybilState
            */
            if (args.values?.inputToken && args.values?.outputToken && (args.values?.inputAmountRaw || args.values?.inputAmountUi || args.values?.fraction)) {
                let wallets = fs.readdirSync(path.join(args.positionals[0], 'Level_CLIENTS'))
                try {
                    let all_cm = await initConnection('helius')
                    args.values.inputToken = (args.values.inputToken == SOL_ADDRESS || args.values.inputToken.toLowerCase() == 'sol' || args.values.inputToken.toLowerCase() == 'wsol') ? WSOL_TOKEN_ADDRESS : args.values.inputToken
                    args.values.outputToken = (args.values.outputToken == SOL_ADDRESS || args.values.outputToken.toLowerCase() == 'sol' || args.values.outputToken.toLowerCase() == 'wsol') ? WSOL_TOKEN_ADDRESS : args.values.outputToken
                    let inputAmount = args.values?.fraction ? { fraction: args.values?.fraction } : { amount: (await getFormatedInputAmount(args, all_cm)) }
                    let slippage = args?.values?.slippage <= 50 ? args.values.slippage * 100 : 50 * 100
                    let stagger = args?.values?.stagger ? parseTime(args.values.stagger) : 0
                    await handleTradeJupiter(args.positionals[0], args.values.inputToken, args.values.outputToken, inputAmount, slippage, stagger, wallets, all_cm)
                } catch (e) {
                    console.log(e)
                }
            } else {
                console.log('missing arguments')
            }
            break;
        }
        case '-sR':
        case '--swapRaydium': {
            /**
             * definition 
             * performs a swap using Raydium Amm pool
             * 
             * short 
             *  -sR
             * 
             * options
             *  - inputToken:(required) the input token to the swap. valid arguments are sol, wsol, or any SPL token address (eg. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
             *  - outputToken:(required) the output token from the swap. valid arguments are sol, wsol, or any SPL token address (eg. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
             *  - slippage:(optional, default 1%) the max slippage for the transaction. valid inputs are integers from 0 - 100 (0% - 100%)
             *  - inputAmountRaw:(*) the raw input amount (eg --inputAmount 1000000000 --> swap 1 SOL
             *  - inputAmountUi:(*) the raw input amount divided by 10 ^ the number of decimals (eg --inputAmount 1 --> distribute 1 SOL)
             *  - fraction:(*) wil swap a fraction of the total input amount. valid inputs range from (0 - 1)  (eg --fraction 0.5 --> sell half of balance)
             *  - ammId(required): the id of the amm pool to swap into (eg.HjQWkE2mGQVnwNrsnR6YcaW2iqZYSJFj879kwUsy8QB)
             * 
             * usage
             *  - ex) -sR --intputToken wsol --outputToken 3boRKAxWR6weV6kufr9ykdLcm9cL5q2p469tCqeCAnHy  --fraction 0.25 --ammId BxbDrMVBdUxtzvSBJNKB5MmRytqjZxcbPsoRVPNn6AU2 
             */
            if (args.values?.inputToken && args.values?.outputToken && (args.values?.inputAmountRaw || args.values?.inputAmountUi || args.values?.fraction) && args.values?.ammId) {
                let wallets = fs.readdirSync(path.join(args.positionals[0], 'Level_CLIENTS'))
                try {
                    let all_cm = await initConnection('all')
                    args.values.inputToken = (args.values.inputToken == SOL_ADDRESS || args.values.inputToken.toLowerCase() == 'sol' || args.values.inputToken.toLowerCase() == 'wsol') ? WSOL_TOKEN_ADDRESS : args.values.inputToken
                    args.values.outputToken = (args.values.outputToken == SOL_ADDRESS || args.values.outputToken.toLowerCase() == 'sol' || args.values.outputToken.toLowerCase() == 'wsol') ? WSOL_TOKEN_ADDRESS : args.values.outputToken
                    let inputAmount = args.values?.fraction ? { fraction: args.values?.fraction } : { amount: (await getFormatedInputAmount(args, all_cm)) }
                    if (args.values?.slippagBps && (args.values.slippagBps < 0 || args.values.slippagBps > 100 || args.values.slippagBps % 1 != 0)) {
                        console.log('invalid slippage: number should be an integer between 0 and 100')
                        break;
                    }
                    let stagger = args?.values?.stagger ? parseTime(args.values.stagger) : 0
                    await handleTradeRaydium(args.positionals[0], new PublicKey(args.values.inputToken), inputAmount, (args.values?.slippage ? args.values.slippage : 25), new PublicKey(args.values.outputToken), args.values.ammId, stagger, wallets, all_cm)
                } catch (e) {
                    console.log(e)
                }
            } else {
                console.log('missing arguments')
            }
            break;

        }
        case '-mL':
        case '--makeLots': {
            /**
             * definition
             * this function creates a list of lists of randomly selected wallets where the batch flag represents the number of wallets per list. ie
             * [
             *  [(wallet 5), (wallet 8), (walletm1), (wallet 2)],
             *  [(wallet 9), (wallet 3), (wallet 6), (wallet 4)],
             *  [(wallet 1)]
             * ]
             *   - batch = 4; total wallets = 10
             * 
             * each wallet object contains the following:
             * {
             *      pK (a wallets bs58 encoded privateKey)
             *      done (a boolean representing a wallets sybil status)
             *      notes (a string for miscellaneous notes)
             * }
             * 
             * -short
             *  -lots
             * 
             * options:
             *  - out : where to write the output file
             *  - batch : the number of wallet objects per list
             * 
             * 
             */
            if (args.values?.out && args.values?.batch) {

                if (fs.existsSync(args.values.out)) {
                    console.error(`${args.values.out} file already exists. dont want to overwrite it. rename the existing file or choose a new name`)
                    break;
                }
                handleLots(path.join(args.positionals[0], 'Level_CLIENTS'), args.values.batch, args.values.out)
            } else {
                console.log('missing arguments')
            }
            break
        }
        case '-s':
        case '--getSummary': {
            /**
             * definition
             * returns a summary of all balances in all wallets at a given level
             * 
             * short
             *  -s
             * 
             * options
             *  -level(optional, default -> LEVEL_CLIENTS) the level (ie folder name) to summarize. valid arguments are (1, 2, 3, ... , CLIENTS)
             * 
             * usage
             *  - ex) -s ./my_wallets --level CLIENTS
             *  - ex) -s ./my_wallets --level 1 
             * 
             */
            try {
                await handleSummary(await initConnection('helius'), path.join(args.positionals[0], args.values?.level ? `LEVEL_${args.values.level.toUpperCase()}` : 'LEVEL_CLIENTS'))
            } catch (e) {
                console.log(e)
            }
            break;
        }

        case '-w':
        case '--writeAll': {
            /**
             * definition
             * write the balances of each wallet at every level to a .json file 
             * 
             * short
             *  -w
             * 
             * options
             *  - out(required): the path/name of the file to be written
             * 
             * usage
             * -ex) -w ./my_wallets --out ./out.json
             * -ex) -w ./my_wallets --out ./something/stuff.json
             *  
             */
            if (!args.values?.out) {
                console.log('--out not specified')
                break;
            }
            try {
                await handleWriteAll(args.positionals[0], args.values.out, await initConnection('helius'))
            } catch (e) {
                console.log(e)
            }
            break
        }
        case '-dump':
        case '--dumpAll': {
            /**
             * definition
             * sells all positions in all wallets through jupiter
             * 
             * short
             *  -dump
             * 
             * options
             *  - outputToken (required) - token to swap to
             *  - slippage - the maximun slippage for the transaction (from 0 - 50)
             * 
             * usage
             *  -ex) -dump ./my_wallets --outputToken wsol --slippage 10
             *  
             */

            if (args?.values?.outputToken) {
              /*  const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });

                rl.question(`Are you sure you want to swap all positions in ${args.positionals[0]} for ${args.values.outputToken} (y/n)? `, async (answer) => {
                   if (answer == 'y') { */
                        let helius_cm = await initConnection('helius')
                        let other_cm = await initConnection('not-helius')

                        let outputToken;
                        if (args.values.outputToken == SOL_ADDRESS || args.values.outputToken.toLowerCase() == 'sol' || args.values.outputToken.toLowerCase() == 'wsol') {
                            outputToken = WSOL_TOKEN_ADDRESS
                        } else if (args.values.outputToken.toLowerCase() == 'usd' || args.values.outputToken.toLowerCase() == 'usdc') {
                            outputToken = USDC_TOKEN_ADDRESS
                        } else {
                            outputToken = args.values.outputToken
                        }
                        let slippage = args?.values?.slippage <= 50 ? args.values.slippage * 100 : 50
                        console.log('dumpin')
                        await handleDumpAll(args.positionals[0], outputToken, slippage, helius_cm, other_cm)
                   // }
                //    rl.close();
               // });
            } else {
                console.log('missing arguments')
            }
            break
        }
        case '-cT':
        case '--closeAccounts': {
            /**
             * definition
             * close all the empty token accounts in all wallets
             * 
             * short
             *  - cT
             * 
             * options
             * - none
             * 
             * usage
             *  - cT ./my_wallets
             * 
             */
            let all_cm = await initConnection('all')
            await handleCloseTokenAccounts(args.positionals[0], all_cm)
            break;
        }

        case '-sT':
        case '--sendTo': {
            /**
             * definition
             *  send specific token from all wallets to a single address (shouldnt use with sybils)
             * 
             * short 
             *  - sT
             * 
             * options
             *  - inputToken(required) : the token to send
             *  - destination(required) : where to send funds to
             *  - inputAmountRaw:(*) the raw input amount (eg --inputAmount 1000000000 --> swap 1 SOL
             *  - inputAmountUi:(*) the raw input amount divided by 10 ^ the number of decimals (eg --inputAmount 1 --> distribute 1 SOL)
             *  - fraction:(*) wil swap a fraction of the total input amount. valid inputs range from (0 - 1)  (eg --fraction 0.5 --> sell half of balance)
             * 
             *      * -> either inputAmoutRaw/ inputAmountUi/ fraction must be present 
             * 
             */
            if (args.values?.inputToken && args.values?.destination && (args.values?.inputAmountRaw || args.values?.inputAmountUi || args.values?.fraction)) {
                let all_cm = await initConnection('helius')
                args.values.inputToken = args.values.inputToken == 'sol' ? SOL_ADDRESS : args.values.inputToken
                let inputAmount = args.values?.fraction ? { fraction: args.values?.fraction } : { amount: (await getFormatedInputAmount(args, all_cm)) }

                handleSendTo(args.values.inputToken, inputAmount, args.values.destination, args.values?.level ? args.values.level : 'CLIENTS', args.positionals[0], all_cm);

            } else {
                console.log('missing arguments')
            }
            break;
        }

        case '-wK':
        case '--withdrawKraken': {
            /**
             * definition
             * withdraws a random amount of sol from kraken to wallets at random intervals (for sybil stuff)
             * 
             * IMPORTANT - since wallets cannot be whitelisted programatically, they must be added before starting the script
             * when whitelisting the wallets, they should be numbered incrementally starting from 1 (ie the *description field should be '1' for
             * the first wallet you add '2' for the next wallet then '3' and so on). do not put any other info in the description field
             * 
             * short
             * -wK
             * 
             * options
             * -maxWallets (required) : the total number of wallets to distribute funds to 
             * -time (required) : the max time by whcih all wallets will have been funded (in the form XhYm -- ie 8h32m -> 8 hours and 32 minutes)
             * -minAmount (required) : minimum amount of SOL a wallet should receive
             * -maxAmount (required) : maximum amount of SOL a wallet should receive
             *
             * usage
             * ex) apecmd -wK ./my_wallets --maxWallets 16 --time 4h30m --minAmount 0.25 --maxAmount 0.35
             * 
             * 
             * - kraken api keys should be in .env file
             */
            //node .\index.js -wK --maxWallets 5 --time 2h --minAmount 0.25 --maxAmount 0.35 

            if (!process.env['API-KEY'] || !process.env['API-SIGN']) {
                console.log('add credentials to .env file')
                break;
            }
            if (args.values?.maxWallets && args.values?.time && args.values?.minAmount && args.values?.maxAmount) {
                let time = parseTime(args.values.time)
                let time_slots = [];
                while (time_slots.length == 0) {
                    let total = 0
                    for (let i = 0; i < args.values.maxWallets - 1; i++) {
                        let slot = Math.floor(Math.random() * time)
                        time_slots.push(slot)
                        total += slot
                        if (total > time) {
                            time_slots = []
                            break
                        }
                    }
                }
                console.log(time_slots)
                await periodicKrakenWithdrawl(args.values.maxWallets, time_slots, Number.parseFloat(args.values.minAmount), Number.parseFloat(args.values.maxAmount), process.env['API-KEY'], process.env['API-SIGN'])
            }
            break;
        }
        case '-ak':
        case '--allKeys': {
            //print all keys from every level
            if (args?.values?.out) {
                handleAllKeys(args.values.level ? args.values.level : 'CLIENTS', args.values.out, args.positionals[0])
            } else {
                console.log('missing arguments')
            }
            break;
        }
        case '-ss':
        case '--sybilState': {
            //find accounts owned by marginfi program 
            if (args?.values?.out) {
                let all_cm = await initConnection('helius')
                await handleSybilState(args.values.out, args.positionals[0], all_cm)
            } else {
                console.log('missing arguments')
            }
            break;
        }
        default: {
            console.error('unrecognized command')
        }
    }
}

/**
 * 
 *  filter -> point to config file  
 *         -> write in console
 * 
 */

