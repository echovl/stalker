import { config } from "dotenv"
import { TelegramChatBot } from "./bot"
import cron from "node-cron"
import winston from "winston"
import Redis from "ioredis"

async function init() {
    config()

    const etherscanApiKey = process.env.ETHERSCAN_API_KEY as string
    const telegramToken = process.env.TELEGRAM_TOKEN as string
    const redisUrl = process.env.REDIS_URL as string

    const logger = winston.createLogger({
        level: "info",
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [new winston.transports.Console()],
    })
    const redis = new Redis(redisUrl)
    const bot = new TelegramChatBot(
        telegramToken,
        etherscanApiKey,
        redis,
        logger
    )

    cron.schedule("*/1 * * * *", () => {
        bot.scanTransactions()
    })

    logger.info("Bot started")
}

init().catch(console.error)
