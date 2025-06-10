// === Required Modules ===
const { https } = require("follow-redirects")
const axios = require("axios")
const crypto = require("crypto")
require("dotenv").config()

// === Configuration ===
const OKX_API_KEY = process.env.OKX_API_KEY
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY
const OKX_BASE_URL = "https://www.okx.com"
const RECIPIENT_PHONE = "+201277891627"

// === Utility Functions ===
const formatSymbol = (symbol) => symbol.split("-").slice(0, 2).join("")
const getTimestamp = () => new Date().toISOString()
const signRequest = (timestamp, method, path, body = "") =>
  crypto
    .createHmac("sha256", OKX_SECRET_KEY)
    .update(timestamp + method + path + body)
    .digest("base64")

// Format grid bot data into a concise summary
function formatGridBotData(data) {
  if (!Array.isArray(data) || data.length === 0) return "Active bots: 0"

  const lines = data.map((bot, i) => {
    const t = bot.uly
    const gp = +parseFloat(bot.gridProfit).toFixed(2)
    const pp = +(parseFloat(bot.pnlRatio) * 100).toFixed(1)
    const d = bot.direction[0].toUpperCase()
    const inv = +parseFloat(bot.investment).toFixed(1)
    const liq = bot.liqPx ? +parseFloat(bot.liqPx).toFixed(2) : "N/A"
    const min = bot.minPx ? +parseFloat(bot.minPx).toFixed(2) : "N/A"
    const max = bot.maxPx ? +parseFloat(bot.maxPx).toFixed(2) : "N/A"

    return `${
      i + 1
    }) ${t} | ${d} | PnL: $${gp} (${pp}%) | Inv: $${inv} | Liq: $${liq} | Range: $${min}->$${max}`
  })

  return `Active bots: ${data.length}\n${lines.join("\n")}`
}

// === Data Fetching Functions ===

// Fetch latest prices for key instruments
async function fetchTickerPrices() {
  const instruments = [
    "BTC-USDT-SWAP",
    "SOL-USDT-SWAP",
    "ETH-USDT-SWAP",
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
    return `Balance: ${Math.round(balance * 100) / 100} USDT`
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
  // won't be possible to fit messageWithgrid in 160 characters
  const messageWithGrid = `${balanceText}\n${pricesText}\n${gridText}`
  const messageWithoutGrid = `${balanceText}\n${pricesText}`

  const message = `${messageWithoutGrid}\n${affirmationText}`
  console.log(message)
  const body = JSON.stringify({
    messages: [
      {
        destinations: [{ to: RECIPIENT_PHONE }],
        from: "OKX Updates",
        text: message
      }
    ]
  })

  const options = {
    method: "POST",
    hostname: "qd2vxq.api.infobip.com",
    path: "/sms/2/text/advanced",
    headers: {
      Authorization: `App ${INFOBIP_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    maxRedirects: 20
  }

  const req = https.request(options, (res) => {
    const chunks = []
    res.on("data", (chunk) => chunks.push(chunk))
    res.on("end", () =>
      console.log("SMS Sent:", Buffer.concat(chunks).toString())
    )
    res.on("error", console.error)
  })
  req.write(body)
  req.end()
}

// === Execute ===
sendAccountUpdateSMS()
