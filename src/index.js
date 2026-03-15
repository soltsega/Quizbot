const { Telegraf, session } = require('telegraf');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = path.join(__dirname, 'db.json');

// Helper to read/write DB
const readDB = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const saveDB = (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

const bot = new Telegraf(process.env.BOT_TOKEN);

// Use session middleware to track creation state
bot.use(session());

bot.start((ctx) => {
    ctx.reply('Welcome to the new QuizBot! 🌟\n\nI can help you create and play quizzes. Use /help to see what I can do.');
});

bot.help((ctx) => {
    ctx.reply(
        'Available commands:\n' +
        '/newquiz - Create a new quiz\n' +
        '/quizzes - List your quizzes\n' +
        '/newworkbook - Create a workbook for your quizzes (Advanced)\n' +
        '/cancel - Abort current operation'
    );
});

// Create Quiz Flow
bot.command('newquiz', (ctx) => {
    ctx.session = { state: 'WAITING_TITLE' };
    ctx.reply('Let\'s create a new quiz! 📝\n\nFirst, send me the **title** of your quiz.');
});

bot.command('cancel', (ctx) => {
    ctx.session = null;
    ctx.reply('Current operation cancelled. 🛑');
});

bot.on('text', (ctx) => {
    const session = ctx.session;
    if (!session) return;

    if (session.state === 'WAITING_TITLE') {
        session.title = ctx.message.text;
        session.state = 'WAITING_DESCRIPTION';
        ctx.reply(`Great! Title: "${session.title}"\n\nNow, send me a brief **description** for this quiz.`);
        return;
    }

    if (session.state === 'WAITING_DESCRIPTION') {
        session.description = ctx.message.text;
        session.state = 'WAITING_QUESTIONS';
        session.questions = [];
        ctx.reply(
            `Description set! ✅\n\nNow, send me your **questions**. \n\nYou should send them as **polls** or **quizzes** by clicking the attachment icon (📎) and choosing "Poll".\n\nWhen you are finished, send /done.`
        );
        return;
    }

    if (session.state === 'WAITING_QUESTIONS' && ctx.message.text === '/done') {
        if (session.questions.length === 0) {
            return ctx.reply('You haven\'t added any questions yet! Please send at least one poll.');
        }

        const db = readDB();
        const quizId = `quiz_${Date.now()}`;
        db.quizzes[quizId] = {
            id: quizId,
            owner: ctx.from.id,
            title: session.title,
            description: session.description,
            questions: session.questions,
            createdAt: new Date().toISOString(),
            stats: { attempts: 0, scores: [] }
        };
        saveDB(db);

        ctx.session = null;
        ctx.reply(`Congratulations! Your quiz "${session.title}" is ready and saved. 🎉\n\nYou can now share it or add it to a workbook.`);
        return;
    }
});

// Handle incoming polls/quizzes for the creation flow
bot.on('poll', (ctx) => {
    const session = ctx.session;
    if (!session || session.state !== 'WAITING_QUESTIONS') return;

    const poll = ctx.poll;
    session.questions.push({
        question: poll.question,
        options: poll.options.map(o => o.text),
        correct_option_id: poll.correct_option_id,
        type: poll.type
    });

    ctx.reply(`Question added! (${session.questions.length} total). Send another poll or /done when finished.`);
});

bot.command('quizzes', (ctx) => {
    const db = readDB();
    const userQuizzes = Object.values(db.quizzes).filter(q => q.owner === ctx.from.id);
    
    if (userQuizzes.length === 0) {
        return ctx.reply('You haven\'t created any quizzes yet. Use /newquiz to start! 🚀');
    }

    let list = 'Your quizzes:\n\n';
    userQuizzes.forEach((q, i) => {
        list += `${i + 1}. **${q.title}** (${q.questions.length} questions)\n`;
    });
    ctx.reply(list);
});

const { Parser } = require('json2csv');

// Existing DB helpers...
// ... (omitting for brevity in replacement, but I will include them in the full write if necessary)

// Workbook Management
bot.command('newworkbook', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /newworkbook <name>');
    
    const name = args.slice(1).join(' ');
    const db = readDB();
    const workbookId = `wb_${Date.now()}`;
    
    db.workbooks[workbookId] = {
        id: workbookId,
        name: name,
        owner: ctx.from.id,
        quizzes: [],
        collaborators: [],
        createdAt: new Date().toISOString()
    };
    saveDB(db);
    ctx.reply(`Workbook "${name}" created! ID: \`${workbookId}\` (Click to copy).`);
});

bot.command('addtoworkbook', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply('Usage: /addtoworkbook <workbook_id> <quiz_id>');

    const [, wbId, qId] = args;
    const db = readDB();
    const wb = db.workbooks[wbId];
    const quiz = db.quizzes[qId];

    if (!wb) return ctx.reply('Workbook not found.');
    if (!quiz) return ctx.reply('Quiz not found.');
    
    // Check permission
    if (wb.owner !== ctx.from.id && !wb.collaborators.includes(ctx.from.id)) {
        return ctx.reply('You do not have permission to modify this workbook.');
    }

    if (!wb.quizzes.includes(qId)) {
        wb.quizzes.push(qId);
        saveDB(db);
        ctx.reply(`Quiz "${quiz.title}" added to workbook "${wb.name}".`);
    } else {
        ctx.reply('This quiz is already in the workbook.');
    }
});

bot.command('shareworkbook', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply('Usage: /shareworkbook <workbook_id> <user_id>');

    const [, wbId, userId] = args;
    const db = readDB();
    const wb = db.workbooks[wbId];

    if (!wb) return ctx.reply('Workbook not found.');
    if (wb.owner !== ctx.from.id) return ctx.reply('Only the owner can share the workbook.');

    const targetUserId = parseInt(userId);
    if (!wb.collaborators.includes(targetUserId)) {
        wb.collaborators.push(targetUserId);
        saveDB(db);
        ctx.reply(`User ${targetUserId} now has access to workbook "${wb.name}".`);
    } else {
        ctx.reply('User already has access.');
    }
});

bot.command('exportstats', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /exportstats <quiz_id>');

    const qId = args[1];
    const db = readDB();
    const quiz = db.quizzes[qId];

    if (!quiz) return ctx.reply('Quiz not found.');
    if (quiz.owner !== ctx.from.id) return ctx.reply('You can only export stats for your own quizzes.');

    if (!quiz.stats.scores || quiz.stats.scores.length === 0) {
        return ctx.reply('No statistics available yet.');
    }

    try {
        const fields = ['userId', 'username', 'score', 'date'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(quiz.stats.scores);

        const fileName = `stats_${qId}.csv`;
        const filePath = path.join(__dirname, fileName);
        fs.writeFileSync(filePath, csv);

        await ctx.replyWithDocument({ source: filePath, filename: fileName });
        fs.unlinkSync(filePath); // Clean up
    } catch (err) {
        console.error(err);
        ctx.reply('Error generating CSV.');
    }
});

bot.command('workbookleaderboard', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /workbookleaderboard <workbook_id>');

    const wbId = args[1];
    const db = readDB();
    const wb = db.workbooks[wbId];

    if (!wb) return ctx.reply('Workbook not found.');

    // Aggregate scores
    const leaderboard = {};
    wb.quizzes.forEach(qId => {
        const quiz = db.quizzes[qId];
        if (quiz && quiz.stats.scores) {
            quiz.stats.scores.forEach(s => {
                if (!leaderboard[s.userId]) {
                    leaderboard[s.userId] = { username: s.username, totalScore: 0 };
                }
                leaderboard[s.userId].totalScore += s.score;
            });
        }
    });

    const sortedLeaderboard = Object.values(leaderboard).sort((a, b) => b.totalScore - a.totalScore);

    if (sortedLeaderboard.length === 0) {
        return ctx.reply('No data yet for this workbook.');
    }

    let text = `🏆 **Cumulative Leaderboard for ${wb.name}**\n\n`;
    sortedLeaderboard.forEach((entry, i) => {
        text += `${i + 1}. ${entry.username}: ${entry.totalScore} pts\n`;
    });
    ctx.reply(text);
});

bot.command('exportworkbook', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /exportworkbook <workbook_id>');

    const wbId = args[1];
    const db = readDB();
    const wb = db.workbooks[wbId];

    if (!wb) return ctx.reply('Workbook not found.');
    if (wb.owner !== ctx.from.id && !wb.collaborators.includes(ctx.from.id)) {
        return ctx.reply('You do not have permission to export this workbook.');
    }

    const quizzes = wb.quizzes.map(qId => db.quizzes[qId]).filter(Boolean);
    if (quizzes.length === 0) return ctx.reply('Workbook is empty.');

    try {
        const data = quizzes.map(q => ({
            quizTitle: q.title,
            questionsCount: q.questions.length,
            attempts: q.stats.attempts,
            createdAt: q.createdAt
        }));

        const fields = ['quizTitle', 'questionsCount', 'attempts', 'createdAt'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(data);

        const fileName = `workbook_${wbId}.csv`;
        const filePath = path.join(__dirname, fileName);
        fs.writeFileSync(filePath, csv);

        await ctx.replyWithDocument({ source: filePath, filename: fileName });
        fs.unlinkSync(filePath);
    } catch (err) {
        console.error(err);
        ctx.reply('Error exporting workbook data.');
    }
});

bot.launch().then(() => {
    console.log('Bot is running with All Features...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
