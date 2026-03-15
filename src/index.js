const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply('Welcome to the new QuizBot! 🌟\n\nI can help you create and play quizzes. Use /help to see what I can do.');
});

bot.help((ctx) => {
    ctx.reply('Currently available commands:\n/start - Start the bot\n/create - Create a new quiz (coming soon)\n/play - Play a quiz (coming soon)');
});

bot.command('ping', (ctx) => ctx.reply('Pong! 🏓'));

bot.launch().then(() => {
    console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
