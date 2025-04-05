import * as solanaWeb3 from "@solana/web3.js";
import { SolanaRpcApiDevnet } from "@solana/rpc";

import * as systemProgram from "@solana-program/system";
import * as computeBudgetProgram from "@solana-program/compute-budget";


enum TransactionStatus {
    NotLanded,
    Landed
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const txStatusChecker = async (
    transactionSignature: solanaWeb3.Signature,
    blockhash: solanaWeb3.Blockhash,
    rpc: solanaWeb3.RpcDevnet<SolanaRpcApiDevnet> 
    // @ts-ignore
): Promise<TransactionStatus> => {
    try {
        while (true) {
            console.log("Waiting for transaction confirmation...");
    
            const blockhashStatus = await rpc.isBlockhashValid(
                blockhash,
                {
                    commitment: "confirmed"
                }
            ).send();
    
            const txInfo = await rpc.getTransaction(transactionSignature).send();
            if (txInfo) {
                if (txInfo.meta?.err) {
                    console.log("Transaction landed on the block. (status: failure)");
                    return TransactionStatus.Landed;
                } else {
                    console.log("Transaction landed on the block. (status: success)");
                    return TransactionStatus.Landed;
                };
            };
    
            if (blockhashStatus.value == false) {
                console.log("Transaction not-landed on the block!");
                return TransactionStatus.NotLanded;
            };
    
            await sleep(500);
        };
    } catch (error) {
        console.error("Checking failed :\n", error);
    };
};

const sendTransaction = async () => {
    try {
        const rpc = solanaWeb3.createSolanaRpc(
            solanaWeb3.devnet(
                "https://api.devnet.solana.com/"
            )
        );
    
        let userKeypair = await solanaWeb3.createKeyPairSignerFromBytes(
            Uint8Array.from(
                [ "KEYPAIR-BYTES" ]
            )
        );
        let unkownAddr = solanaWeb3.address("<PUBKEY>");

        let newAccount = await solanaWeb3.generateKeyPair();
        let newAccountPubkey = await solanaWeb3.getAddressFromPublicKey(newAccount.publicKey);
        
        const latestBlockhash = (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value;
        const transferSolIx = systemProgram.getTransferSolInstruction(
            {
                amount: solanaWeb3.lamports(1_000n), // solanaWeb3.getLamportsEncoder(), solanaWeb3.getLamportsDecoder()
                source: userKeypair,
                destination: unkownAddr
            }
        );
        const transactionMessage = solanaWeb3.pipe(
            solanaWeb3.createTransactionMessage({ version: "legacy" }),
            txMsg => solanaWeb3.setTransactionMessageFeePayer(userKeypair.address, txMsg),
            txMsg => solanaWeb3.setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, txMsg),
            txMsg => solanaWeb3.appendTransactionMessageInstructions(
                [
                    computeBudgetProgram.getSetLoadedAccountsDataSizeLimitInstruction({ accountDataSizeLimit: 500 }),
                    transferSolIx,
                    {
                        programAddress: solanaWeb3.address("<PUBKEY>"),
                        accounts: [
                            {
                                address: newAccountPubkey,
                                role: solanaWeb3.AccountRole.WRITABLE_SIGNER
                            },
                            {
                                address: userKeypair.address,
                                role: solanaWeb3.AccountRole.WRITABLE_SIGNER
                            },
                            {
                                address: systemProgram.SYSTEM_PROGRAM_ADDRESS,
                                role: solanaWeb3.AccountRole.READONLY
                            }
                        ],
                        data: new Uint8Array([ 0 ])
                    },
                    {
                        programAddress: solanaWeb3.address("<PUBKEY>"),
                        accounts: [
                            {
                                address: newAccountPubkey,
                                role: solanaWeb3.AccountRole.WRITABLE
                            },
                            {
                                address: userKeypair.address,
                                role: solanaWeb3.AccountRole.WRITABLE
                            }
                        ],
                        data: new Uint8Array([ 1 ])
                    }
                ],
                txMsg
            )
        );
    
        /// Estimate Required CUs
        const getComputeUnitEstimateForTx = solanaWeb3.getComputeUnitEstimateForTransactionMessageFactory(
            {
                rpc
            }
        );
        const estimatedCu = await getComputeUnitEstimateForTx(transactionMessage, { commitment: "confirmed" });
        const finalEstimatedCu = estimatedCu + estimatedCu * 0.1 + 300;
        console.log(`Estimated CU - ${finalEstimatedCu}`);
        /// Estimate Required CUs
    
        /// Fetch Priority Fees
        const recentPriorityFees = await rpc.getRecentPrioritizationFees(
            [
                userKeypair.address,
                unkownAddr
            ]
        ).send();
        let bestCuPrice = 0;
        recentPriorityFees.forEach(v => {
            let pf = Number(v.prioritizationFee);
            if (pf > bestCuPrice) {
                bestCuPrice = pf;
            };
        });
        const finalBestCuPrice = Math.round(bestCuPrice + bestCuPrice * 0.1);
        console.log(`Prioritization Fee - ${finalBestCuPrice}`);
        /// Fetch Priority Fees
    
        /// Add Transaction-Optimizer Instructions To The Transaction
        const budgetedAndOptimizedTransactionMsg = solanaWeb3.prependTransactionMessageInstructions(
            [
                computeBudgetProgram.getSetComputeUnitLimitInstruction({ units: finalEstimatedCu }),
                computeBudgetProgram.getSetComputeUnitPriceInstruction({ microLamports: finalBestCuPrice })
            ],
            transactionMessage
        );
    
        const partiallySignedTx = await solanaWeb3.partiallySignTransactionMessageWithSigners(budgetedAndOptimizedTransactionMsg);
        const fullySignedTx = await solanaWeb3.signTransaction(
            [ newAccount ],
            partiallySignedTx
        );
    
        const sendTx = solanaWeb3.sendTransactionWithoutConfirmingFactory(
            {
                rpc
            }
        );
        await sendTx(
            fullySignedTx,
            {
                commitment: "confirmed",
                maxRetries: 0n,
                skipPreflight: true
            }
        );
    
        const transactionSignature = solanaWeb3.getSignatureFromTransaction(fullySignedTx);
        console.log(`Transaction Signature - ${transactionSignature}`);
    
        const txStatus = await txStatusChecker(
            transactionSignature,
            latestBlockhash.blockhash,
            rpc
        );
    
        if (txStatus == TransactionStatus.NotLanded) {
            return sendTransaction();
        };
    } catch (error) {
        console.error("Program failed :\n", error);
    };
};

(async () => {
    console.log("\n");
    await sendTransaction();
    console.log("\n");
})();
