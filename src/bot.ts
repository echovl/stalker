import { providers } from "ethers"
import { Redis } from "ioredis"
import Telegram from "node-telegram-bot-api"
import winston from "winston"

const START_REGEX = /\/start/
const ADD_REGEX = /\/add (.+) (.+)/
const REMOVE_REGEX = /\/remove (.+)/
const LIST_REGEX = /\/list/

const startMessage = `You can control me by sending these commands:

    /add address alias - add new address to stalk
    /remove alias - remove address
    /list  - get the current addresses
`

type Target = {
    lastBlockChecked: number
    address: string
    alias: string
}

type Stalker = {
    chatId: number
    targets: Array<Target>
}

export class TelegramChatBot {
    api: Telegram
    etherscanProvider: providers.EtherscanProvider
    redis: Redis
    logger: winston.Logger

    constructor(
        telegramToken: string,
        etherscanApiKey: string,
        redis: Redis,
        logger: winston.Logger
    ) {
        this.api = new Telegram(telegramToken, { polling: true })
        this.etherscanProvider = new providers.EtherscanProvider(
            "arbitrum",
            etherscanApiKey
        )
        this.redis = redis
        this.logger = logger

        this.api.onText(START_REGEX, this.handleStartCmd.bind(this))
        this.api.onText(ADD_REGEX, this.handleAddCmd.bind(this))
        this.api.onText(REMOVE_REGEX, this.handleRemoveCmd.bind(this))
        this.api.onText(LIST_REGEX, this.handleListCmd.bind(this))
    }

    async handleStartCmd(msg: Telegram.Message, _: RegExpExecArray | null) {
        const chatId = msg.chat.id

        return this.api.sendMessage(chatId, startMessage)
    }

    async handleListCmd(msg: Telegram.Message, _: RegExpExecArray | null) {
        const chatId = msg.chat.id

        const stalker = await this.getStalker(chatId)

        if (stalker) {
            if (stalker.targets.length === 0) {
                return this.api.sendMessage(chatId, "No targets registered")
            }

            let listMsg = "Targets:\n\n"
            for (const target of stalker.targets) {
                listMsg += `${target.alias} => ${target.address}\n`
            }

            return this.api.sendMessage(chatId, listMsg)
        } else {
            return this.api.sendMessage(chatId, "No targets registered")
        }
    }

    async handleAddCmd(msg: Telegram.Message, match: RegExpExecArray | null) {
        const chatId = msg.chat.id

        if (match && match.length == 3) {
            const address = match[1]
            const alias = match[2]

            const stalker = await this.getStalker(chatId)
            const currentBlock = await this.etherscanProvider.getBlockNumber()

            if (stalker) {
                stalker.targets.push({
                    address,
                    lastBlockChecked: currentBlock,
                    alias,
                })

                await this.putStalker(stalker)
            } else {
                this.putStalker({
                    chatId,
                    targets: new Array({
                        address,
                        lastBlockChecked: currentBlock,
                        alias,
                    }),
                })
            }

            return this.api.sendMessage(chatId, "Address added successfully")
        } else {
            return this.api.sendMessage(chatId, "Missing address or alias")
        }
    }

    async handleRemoveCmd(
        msg: Telegram.Message,
        match: RegExpExecArray | null
    ) {
        const chatId = msg.chat.id

        if (match && match.length == 2) {
            const alias = match[1]

            const stalker = await this.getStalker(chatId)

            if (stalker) {
                stalker.targets = stalker.targets.filter(
                    (st) => st.alias !== alias
                )

                await this.putStalker(stalker)
            }

            return this.api.sendMessage(chatId, "Address removed successfully")
        } else {
            return this.api.sendMessage(chatId, "Missing alias")
        }
    }

    async scanTransactions() {
        const currentBlock = await this.etherscanProvider.getBlockNumber()

        this.logger.info(`Scanning block ${currentBlock}`)

        const stalkers = await this.allStalkers()

        for (const stalker of stalkers) {
            for (const target of stalker.targets) {
                const txHistory = await this.etherscanProvider.getHistory(
                    target.address,
                    target.lastBlockChecked,
                    currentBlock
                )

                target.lastBlockChecked = currentBlock

                await this.putStalker(stalker)

                if (txHistory.length === 0) continue

                this.logger.info(
                    `Found ${txHistory.length} transactions from ${target.address}`
                )

                for (const tx of txHistory) {
                    this.api.sendMessage(
                        stalker.chatId,
                        `New transaction from ${target.alias}: https://arbiscan.io/tx/${tx.hash}`
                    )
                }
            }
        }
    }

    async putStalker(stalker: Stalker): Promise<void> {
        await this.redis.set(stalker.chatId.toString(), JSON.stringify(stalker))
    }

    async getStalker(chatId: number): Promise<Stalker | null> {
        const stalker = await this.redis.get(chatId.toString())

        if (stalker) {
            return JSON.parse(stalker)
        }

        return null
    }

    async allStalkers(): Promise<Array<Stalker>> {
        const keys = await this.redis.keys("*")

        const rawStalkers = await this.redis.mget(keys)
        const stalkers = new Array<Stalker>()

        for (const raw of rawStalkers) {
            if (raw) {
                stalkers.push(JSON.parse(raw))
            }
        }

        return stalkers
    }
}
