// === Required Modules ===
const { https } = require("follow-redirects")
const axios = require("axios")
const crypto = require("crypto")
const express = require("express")
const app = express()
require("dotenv").config()

const PORT = process.env.PORT || 3000

// === Configuration ===
const OKX_API_KEY = process.env.OKX_API_KEY
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const RECIPIENT_PHONE_NUMBER = process.env.RECIPIENT_PHONE_NUMBER
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER
const OKX_BASE_URL = "https://www.okx.com"
const twilioClient = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

// === Utility Functions ===
const formatSymbol = (symbol) => symbol.split("-")[0]
const getTimestamp = () => new Date().toISOString()
const signRequest = (timestamp, method, path, body = "") =>
  crypto
    .createHmac("sha256", OKX_SECRET_KEY)
    .update(timestamp + method + path + body)
    .digest("base64")

// Format grid bot data into a concise summary
function formatGridBotData(data) {
  if (!Array.isArray(data) || data.length === 0) return "Active bots: 0"
  console.log("Grid Bot Data:", data)
  const lines = data.map((bot, i) => {
    const t = bot.uly.split("-")[0]
    const gp = +parseFloat(bot.gridProfit).toFixed(2)
    const totalPnl = +parseFloat(bot.totalPnl).toFixed(2)
    const pp = +(parseFloat(bot.pnlRatio) * 100).toFixed(1)
    const d = bot.direction[0].toUpperCase()
    const inv = +parseFloat(bot.investment).toFixed(1)
    const liq = bot.liqPx ? +parseFloat(bot.liqPx).toFixed(2) : "N/A"
    const min = bot.minPx ? +parseFloat(bot.minPx).toFixed(2) : "N/A"
    const max = bot.maxPx ? +parseFloat(bot.maxPx).toFixed(2) : "N/A"
    const arb = bot.arbitrageNum ?? "N/A" // fallback if arbitrageNum is missing

    return `${t}|${d}|PnL: $${totalPnl}(${pp}%)|Inv: $${inv}|Liq: $${liq}|R: $${min}->$${max}|Arbs: ${arb}($${gp})`
  })

  return `${lines.join("\n")}`
}

// === Data Fetching Functions ===

// Fetch latest prices for key instruments
async function fetchTickerPrices() {
  const instruments = [
    "BTC-USDT-SWAP",
    // "SOL-USDT-SWAP", // Uncomment if you want to include SOL removed for charcter limit
    // "ETH-USDT-SWAP",  // Uncomment if you want to include ETH removed for charcter limit
    "LINK-USDT-SWAP"
  ]
  const headers = { "Content-Type": "application/json" }

  try {
    const res = await Promise.all(
      instruments.map((inst) =>
        axios.get(`${OKX_BASE_URL}/api/v5/market/ticker?instId=${inst}`, {
          headers
        })
      )
    )
    return res
      .map((r, i) => `${formatSymbol(instruments[i])}: ${r.data.data[0].last}`)
      .join("\n")
  } catch (err) {
    console.error("Ticker Error:", err.response?.data || err.message)
    return "Error fetching prices."
  }
}

// Fetch account balance summary
async function fetchAccountBalance() {
  const method = "GET"
  const path = "/api/v5/account/balance"
  const timestamp = getTimestamp()
  const sign = signRequest(timestamp, method, path)

  const headers = {
    "OK-ACCESS-KEY": OKX_API_KEY,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
    "Content-Type": "application/json"
  }

  try {
    const res = await axios.get(`${OKX_BASE_URL}${path}`, { headers })
    const balance = res.data.data[0].totalEq
    return `Eq:$${Math.round(balance * 100) / 100}`
  } catch (err) {
    console.error("Balance Error:", err.response?.data || err.message)
    return "Error fetching balance."
  }
}

// Fetch currently running grid bots
async function fetchRunningGridBots() {
  const method = "GET"
  const path =
    "/api/v5/tradingBot/grid/orders-algo-pending?algoOrdType=contract_grid"
  const timestamp = getTimestamp()
  const sign = signRequest(timestamp, method, path)

  const headers = {
    "OK-ACCESS-KEY": OKX_API_KEY,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
    "Content-Type": "application/json"
  }

  try {
    const res = await axios.get(`${OKX_BASE_URL}${path}`, { headers })
    return formatGridBotData(res.data?.data || [])
  } catch (err) {
    console.error("Grid Bot Error:", err.response?.data || err.message)
    return "Error fetching grid bots."
  }
}
// Fetch affirmation text from external source
async function fetchAffirmationText() {
  try {
    const response = await axios.get("https://www.affirmations.dev/")
    return response.data.affirmation
  } catch (error) {
    console.error("Affirmation Error:", error.response?.data || error.message)
    return "Keep going, you're doing great!"
  }
}
// === SMS Sender ===
async function sendAccountUpdateSMS() {
  const [balanceText, pricesText, gridText, affirmationText] =
    await Promise.all([
      fetchAccountBalance(),
      fetchTickerPrices(),
      fetchRunningGridBots(),
      fetchAffirmationText()
    ])

  const messageWithGridDetails = `${balanceText}\n${pricesText}\n${gridText}`
  const messageWithoutGridDetails = `${balanceText}\n${pricesText}`
  const message = `${messageWithoutGridDetails}\n${affirmationText}` // use when there are no grid bots running
  const messageWithGrid = `${messageWithGridDetails}\n` // use when there are grid bots running can't have affirmation text in this case due to character limit

  try {
    await twilioClient.messages.create({
      body: messageWithGrid.slice(0, 121), // Limit to 121 characters as twilio adds mandotory prefix of 38 characters totalling 159 characters
      from: TWILIO_PHONE_NUMBER,
      to: RECIPIENT_PHONE_NUMBER
    })
    console.log(messageWithGrid.slice(0, 121))
    console.log("SMS sent successfully!")
  } catch (err) {
    console.error("SMS sending failed:", err)
  }
}
// === ENDPOINT ===
app.get("/", (req, res) => {
  console.log("Welcome to TickerHug! 🚀")
  res.send("Welcome to TickerHug! 🚀")
})
app.get("/run-cron", async (req, res) => {
  try {
    await sendAccountUpdateSMS()
    console.log("cron ran at", new Date().toISOString())
    res.status(200).send("Cron job executed successfully.")
  } catch (err) {
    console.error("Cron job failed:", err)
    res.status(500).send("Cron job failed.")
  }
})
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
