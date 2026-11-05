#!/usr/bin/env node
// Deploys contracts/bump_audit.py to GenLayer Studionet and prints the address.
//   BA_PRIVATE_KEY=0x...   optional (a throw-away key is generated otherwise)
//   node scripts/deploy.mjs
import { createAccount, deployContract, EXPLORER, fund, generatePrivateKey, makeClient } from "./lib.mjs";

const key = process.env.BA_PRIVATE_KEY || generatePrivateKey();
const account = createAccount(key);
const client = makeClient(account);
const funded = await fund(client, account.address);
console.log(`deployer ${account.address}${funded === true ? " (funded via sim_fundAccount)" : ` (funding note: ${funded})`}`);
if (!process.env.BA_PRIVATE_KEY) console.log(`generated key (keep it if you want to reuse this deployer): ${key}`);
const { address, hash } = await deployContract(client);
console.log(`\nBumpAudit deployed\n  address : ${address}\n  tx      : ${EXPLORER}/tx/${hash}\n  contract: ${EXPLORER}/contracts/${address}`);
console.log(`\nNext:\n  export BA_CONTRACT_ADDRESS=${address}\n  npm run demo -- --base https://raw.githubusercontent.com/<you>/<repo>/main/examples/fixtures`);
