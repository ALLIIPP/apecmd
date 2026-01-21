const cla = {
    "options": {
        "makeWallets": {
            "type": "boolean"
        },
        "distributeToken": {
            "type": "boolean"
        },
        "swapJupiter": {
            "type": "boolean"
        },
        "swapRaydium": {
            "type": "boolean"
        },
        "summary": {
            "type": "boolean",
        },
        "writeAll": {
            "type": "boolean",
        },
        "dumpAll": {
            "type": "boolean"
        },
        "sendTo":{
            "type":"boolean"
        },
        "allKeys":{
            "type":"string"
        },
        "depth": {
            "type": "string"
        },
        "legs": {
            "type": "string"
        },
        "seed": {
            "type": "string"
        },
        "inputToken": {
            "type": "string"
        },
        "inputAmountRaw": {
            "type": "string"
        },
        "inputAmountUi": {
            "type": "string"
        },
        "level": {
            "type": "string"
        },
        "out": {
            "type": "string"
        },
        "fraction": {
            "type": "string"
        },
        "outputToken": {
            "type": "string"
        },
        "slippage": {
            "type": "string"
        },
        "ammId": {
            "type": "string"
        },
        "batch": {
            "type": "string"
        },
        "maxWallets": {
            "type": "string"
        },
        "time": {
            "type": "string"
        },
        "minAmount": {
            "type": "string"
        },
        "maxAmount": {
            "type": "string"
        },
        "stagger": {
            "type": "string"
        },
        "destination":{
            "type":"string"
        }
    },
    "allowPositionals": true,
    "strict": false
}

module.exports = cla