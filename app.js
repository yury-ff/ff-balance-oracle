const express = require("express");
const app = express();

const axios = require("axios");
const { ethers } = require("ethers");
require("dotenv").config();

// const common = require("./common.js");

const SLEEP_INTERVAL = process.env.SLEEP_INTERVAL || 2000;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CHUNK_SIZE = process.env.CHUNK_SIZE || 3;
const MAX_RETRIES = process.env.MAX_RETRIES || 5;
const OracleJSON = require("./BalanceOracleABI.json");
const oracleAddress = process.env.ORACLE_ADDRESS;
const url = "https://server.forkedfinance.xyz";
let pendingRequests = [];

async function retrieveUpdatedUserBalance(userAddress) {
  const resp = await axios({
    url: `${url}/${userAddress}`,
    method: "get",
  });
  return resp.data;
}

async function getOracleContract() {
  const provider = new ethers.providers.JsonRpcProvider(
    `https://eth-goerli.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  );
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  return new ethers.Contract(oracleAddress, OracleJSON, signer);
}

async function filterEvents(oracleContract) {
  oracleContract.on("UpdateUserBalanceEvent", async (address, id, value) => {
    let info = {
      address: address,
      id: id,
      value: ethers.utils.formatUnits(value, 6),
    };
    const amount = JSON.parse(info.value);
    console.log(
      "* New Update User Balance Event. Amount: " +
        amount +
        " with id " +
        id +
        " at address: " +
        address
    );
    await addRequestToQueue(info);
  });

  oracleContract.on(
    "SetUserBalanceEvent",
    async (userBalance, userAddress, value) => {
      let info = {
        balance: userBalance,
        address: userAddress,
        value: ethers.utils.formatUnits(value, 6),
      };
      const amount = JSON.parse(info.value);
      const balance = JSON.parse(info.balance);
      console.log(
        "* New Set User Balance Event. Amount: " +
          amount +
          " with a total balance of " +
          balance +
          " at address: " +
          info.address
      );
    }
  );
}

async function addRequestToQueue(info) {
  const userAddress = info.address;
  const id = parseInt(info.id);
  const amount = JSON.parse(info.value);
  pendingRequests.push({ userAddress, id, amount });
}

async function processQueue(oracleContract) {
  let processedRequests = 0;
  while (pendingRequests.length > 0 && processedRequests < CHUNK_SIZE) {
    const req = pendingRequests.shift();
    await processRequest(oracleContract, req.userAddress, req.id, req.amount);
    processedRequests++;
  }
}

async function processRequest(oracleContract, userAddress, id, amount) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      const userBalance = await retrieveUpdatedUserBalance(userAddress);
      await setUserBalance(
        oracleContract,
        userBalance,
        userAddress,
        id,
        amount
      );
      return;
    } catch (error) {
      if (retries === MAX_RETRIES - 1) {
        await setUserBalance(oracleContract, "0", id, amount);
        return;
      }
      retries++;
    }
  }
}

async function setUserBalance(
  oracleContract,
  userBalance,
  userAddress,
  id,
  amount
) {
  // const idInt = new BN(parseInt(id));
  // const userBalanceInt = new BN(parseInt(userBalance));
  const amountInt = parseInt(amount);
  const callerAddress = process.env.BANK_ADDRESS.toString();
  // console.log(
  //   userBalance,
  //   "userAddress " + userAddress.toString(),
  //   "callerAddress " + callerAddress,
  //   parseInt(id),
  //   amount
  // );
  try {
    await oracleContract.setUserBalance(
      userBalance,
      userAddress.toString(),
      callerAddress,
      parseInt(id),
      amount
    );
  } catch (error) {
    console.log("Error encountered while calling setUserBalance " + error);
    // Do some error handling
  }
}

async function init() {
  const oracleContract = await getOracleContract();
  filterEvents(oracleContract);
  return { oracleContract };
}

const port = process.env.PORT || 4000;

const start = async () => {
  try {
    const { oracleContract } = await init();
    setInterval(async () => {
      await processQueue(oracleContract);
    }, SLEEP_INTERVAL);
    app.listen(port, () =>
      console.log(`Server is listening on port ${port}...`)
    );
  } catch (error) {
    console.log(error);
  }
};

start();
