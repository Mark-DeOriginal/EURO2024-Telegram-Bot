const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs").promises;
const cron = require("node-cron");
const axios = require("axios");
// const Markup = require("telegraf/markup");

require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const BOT_ADMIN_PASSWORD = process.env.BOT_ADMIN_PASSWORD;
const HOST = process.env.HOST;
const LIVE_SCORE_API_KEY = process.env.LIVE_SCORE_API_KEY;
const LIVE_SCORE_SECRET_KEY = process.env.LIVE_SCORE_SECRET_KEY;
const LIVE_SCORE_STATISTICS_URL =
  "https://livescore-api.com/api-client/matches/stats.json";
const LIVE_SCORE_EVENTS_URL =
  "https://livescore-api.com/api-client/scores/events.json";

const bot = new Telegraf(BOT_TOKEN);
let cronJob;

// Set up Express
const app = express();
app.use(express.json());

// Todo: Uncomment later
// Set webhook
// bot.telegram.setWebhook(`${HOST}/bot${BOT_TOKEN}`);

// Set commands for private chats
bot.telegram.setMyCommands(
  [
    { command: "start", description: "Start EURO Messenger" },
    { command: "euro_live", description: "Get live match info" },
    { command: "euro_fixtures", description: "Get EURO fixtures" },
    { command: "euro_standings", description: "Get Teams' previous standings" },
    { command: "euro_teams_info", description: "Get Teams information" },
    { command: "euro_subscribe", description: "Subscribe to live updates" },
    { command: "euro_unsubscribe", description: "Unsubscribe from updates" },
  ],
  { scope: { type: "all_private_chats" } }
);

// Set commands for group chats
bot.telegram.setMyCommands(
  [
    { command: "euro_live", description: "Get live match info" },
    { command: "euro_fixtures", description: "Get EURO fixtures" },
    { command: "euro_standings", description: "Get Teams' previous standings" },
    { command: "euro_teams_info", description: "Get Teams information" },
    { command: "euro_subscribe", description: "Subscribe to live updates" },
    {
      command: "euro_unsubscribe",
      description: "Unsubscribe group from updates",
    },
  ],
  { scope: { type: "all_group_chats" } }
);

// Webhook endpoint
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.get("/", (req, res) => {
  console.log("This is EURO 2024 Bot endpoint");
  res.send("<b>This is EURO 2024 Bot endpoint</b>");
});

async function setWebhook() {
  try {
    const data = await fs.readFile("webhook-status.json");
    const webhookSet = JSON.parse(data).isWebhookSet;
    if (!webhookSet) {
      await bot.telegram.setWebhook(`${HOST}/bot${BOT_TOKEN}`);
      console.log("Webhook set successfully");
      await fs.writeFile(
        "webhook-status.json",
        JSON.stringify({ isWebhookSet: true })
      );
    }
  } catch (error) {
    await bot.telegram.setWebhook(`${HOST}/bot${BOT_TOKEN}`);
    console.log("Webhook set successfully");
    await fs.writeFile(
      "webhook-status.json",
      JSON.stringify({ isWebhookSet: true })
    );
  }
}

// TODO: Uncomment later
// Call setWebhook once when the server starts
// setWebhook();

const subscribeGroup = async (ctx, groupId) => {
  try {
    let subscribers = await loadSubscribers();

    if (!subscribers.groups.includes(groupId)) {
      subscribers.groups.push(groupId);
      await saveSubscribers(subscribers);
      ctx.reply("Subscription successful.");
      await informBotAdmin(
        ctx,
        `A group just subscribed to \nEURO 2024 Messenger.\n\nDetails:\nUsername: ${
          !ctx.chat.username ? "Not available" : "@" + ctx.chat.username
        } \nTitle: ${ctx.chat.title}`
      );
      return;
    }

    ctx.reply("Group currently subscribed.");
  } catch (error) {
    console.error("Error subscribing group:", error);
    return false;
  }
};

const unsubscribeGroup = async (ctx, groupId) => {
  try {
    let subscribers = await loadSubscribers();

    if (subscribers.groups.includes(groupId)) {
      subscribers.groups = subscribers.groups.filter((id) => id !== groupId);
      await saveSubscribers(subscribers);
      ctx.reply("Group unsubscribed successfully.");
      await informBotAdmin(
        ctx,
        `A group just unsubscribed from \nEURO 2024 Messenger.\n\nDetails:\nUsername: ${
          !ctx.chat.username ? "Not available" : "@" + ctx.chat.username
        } \nTitle: ${ctx.chat.title}`
      );
      return;
    }

    ctx.reply("Group is currently unsubscribed.");
  } catch (error) {
    console.error("Error unsubscribing group:", error);
    return false;
  }
};

const subscribeUser = async (ctx, chatId) => {
  try {
    let subscribers = await loadSubscribers();

    if (!subscribers.users.includes(chatId)) {
      subscribers.users.push(chatId);
      await saveSubscribers(subscribers);
      ctx.reply("Subscription successful.");
      await informBotAdmin(
        ctx,
        `A Telegram User just subscribed to \nEURO 2024 Messenger.\n\nDetails:\nUsername: ${
          ctx.chat.first_name
        } ${(ctx.chat.last_name && ctx.chat.last_name) || "Not available"}`
      );

      return;
    }

    ctx.reply("You're currently subscribed.");
  } catch (error) {
    console.error("Error subscribing user:", error);
    return false;
  }
};

const unsubscribeUser = async (ctx, chatId) => {
  try {
    let subscribers = await loadSubscribers();

    if (subscribers.users.includes(chatId)) {
      subscribers.users = subscribers.users.filter((id) => id !== chatId);
      await saveSubscribers(subscribers);
      ctx.reply("You have unsubscribed successfully.");
      await informBotAdmin(
        ctx,
        `A User just unsubscribed from \nEURO 2024 Messenger.\n\nDetails:\nUsername: ${
          ctx.chat.first_name
        } ${ctx.chat.last_name && ctx.chat.last_name}`
      );

      return;
    }

    ctx.reply("You're currently unsubscribed.");
  } catch (error) {
    console.error("Error unsubscribing user:", error);
    return false;
  }
};

const loadSubscribers = async () => {
  try {
    const data = await fs.readFile("subscribers.json", "utf8");
    return JSON.parse(data);
  } catch (error) {
    return { users: [], groups: [] };
  }
};

const saveSubscribers = async (subscribers) => {
  await fs.writeFile("subscribers.json", JSON.stringify(subscribers));
};

// Command handlers
bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId > 0) {
    // Automatically subscribe the user
    let subscribers = await loadSubscribers();

    if (!subscribers.users.includes(chatId)) {
      subscribers.users.push(chatId);
      await saveSubscribers(subscribers);
      await informBotAdmin(
        ctx,
        `A Telegram User just subscribed to \nEURO 2024 Messenger.\n\nDetails:\nUsername: ${
          ctx.chat.first_name
        } ${(ctx.chat.last_name && ctx.chat.last_name) || "Not available"}`
      );
    }

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "📊 Dexscreener",
            url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
          },
          { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
        ],
      ],
    };

    const message = `Hey there! 👋

<b>I am EURO 2024 Messenger</b>

Want me to keep your group updated?

1. <b>Add me to your Group</b> 
    - Add @euro_messenger_bot to your group.

2. <b>Make me an Admin</b>
    - I need to be an Admin to interact with your group.

3. <b>Subscribe for Updates</b>
    - Send /euro_subscribe in your group to Subscribe and stay updated.

4. <b>Unsubscribe from Updates</b>
    - To unsubscribe, simply go to your group and send /euro_unsubscribe.

That's it! 🎉

Thank you for choosing Euro 2024 Messenger! ⚽️🏆`;

    bot.telegram.sendPhoto(
      chatId,
      {
        source: "euro-logo.png",
      },
      {
        caption: message,
        parse_mode: "HTML",
        reply_markup: inlineKeyboard,
      }
    );
  }
});

bot.command("euro_subscribe", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId > 0) {
    await subscribeUser(ctx, chatId);
  } else {
    const groupId = ctx.chat.id;
    await subscribeGroup(ctx, groupId);
  }
});

bot.command("euro_unsubscribe", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId > 0) {
    await unsubscribeUser(ctx, chatId);
  } else {
    const groupId = ctx.chat.id;
    await unsubscribeGroup(ctx, groupId);
  }
});

bot.command("set_bot_admin", async (ctx) => {
  const userPassword = ctx.message.text.replace("/set_bot_admin ", "");
  if (ctx.chat.id > 0) {
    if (userPassword === BOT_ADMIN_PASSWORD) {
      try {
        const admins = await loadBotAdmins();
        if (!admins.includes(ctx.chat.id)) {
          admins.push(ctx.chat.id);
          await saveBotAdmins(admins);
          ctx.reply("You have been added as admin.");
        } else {
          ctx.reply("You're already an admin.");
        }
      } catch (error) {
        console.error("Error adding bot admin:", error);
        ctx.reply("An error occurred while adding you as admin.");
      }
    } else {
      ctx.reply(
        "Incorrect password.\nRun command again with correct password."
      );
    }
  }
});

async function getMatchInfo(matchId) {
  // Fetch match scores and statistics from the API
  const scores = await axios.get(
    `${LIVE_SCORE_EVENTS_URL}?key=${LIVE_SCORE_API_KEY}&secret=${LIVE_SCORE_SECRET_KEY}&id=${matchId}`
  );
  const statistics = await axios.get(
    `${LIVE_SCORE_STATISTICS_URL}?match_id=${matchId}&key=${LIVE_SCORE_API_KEY}&secret=${LIVE_SCORE_SECRET_KEY}`
  );

  if (!scores.success && !statistics.success) {
    return false;
  } else {
    return { score: scores.data.match.score, statistics: statistics.data };
  }
}

async function sendStatistics(ctx) {
  try {
    // Read the match schedules
    const matchSchedules = await fs.readFile("match-schedule.json", "utf-8");
    const matches = JSON.parse(matchSchedules);

    // Get the current date and time
    const now = new Date();
    let currentMatch = matches.find((match) => {
      const matchTime = new Date(match.DateUtc);
      // Check if the current time is within the match duration (assuming 120 minutes for each match)
      return (
        now >= matchTime &&
        now <= new Date(matchTime.getTime() + 120 * 60 * 1000)
      );
    });

    let isLive = true;

    if (!currentMatch) {
      // Find the next upcoming match
      currentMatch = matches.find((match) => new Date(match.DateUtc) > now);
      isLive = false;
    }

    if (!currentMatch) {
      ctx.reply("⚽️ No live or upcoming matches found.");
      return;
    }

    let statsMessage = `
<b>EURO 2024 Live Update</b>

-------------------------
🏟️ <b>${currentMatch.HomeTeam}</b> vs <b>${currentMatch.AwayTeam}</b>
👥 ${currentMatch.Group}
📍 ${currentMatch.Location}
-------------------------`;

    if (isLive) {
      // Get the match ID
      const matchId = currentMatch.MatchId;

      const matchInfo = await getMatchInfo(matchId);

      if (!matchInfo) {
        ctx.reply("⚠️ Failed to retrieve match data.");
        return;
      }

      const goals = matchInfo.score;
      const stats = matchInfo.statistics;

      statsMessage += `
GOALS:  ${goals && goals}
-------------------------

📊 <b>Match Statistics</b>

Yellow Cards: ${stats.yellow_cards}
Red Cards: ${stats.red_cards}
Substitutions: ${stats.substitutions}
Possession: ${stats.possesion}
Free Kicks: ${stats.free_kicks}
Goal Kicks: ${stats.goal_kicks}
Throw Ins: ${stats.throw_ins}
Offsides: ${stats.offsides}
Corners: ${stats.corners}
Shots on Target: ${stats.shots_on_target}
Shots off Target: ${stats.shots_off_target}
Attempts on Goal: ${stats.attempts_on_goal}
Saves: ${stats.saves}
Fouls: ${stats.fauls}
Treatments: ${stats.treatments}
Penalties: ${stats.penalties}
Shots Blocked: ${stats.shots_blocked}
Dangerous Attacks: ${stats.dangerous_attacks}
Attacks: ${stats.attacks}
`;
    } else {
      statsMessage += `
GOALS: N/A
-------------------------

📊 <b>Match Statistics</b>

Yellow Cards: N/A
Red Cards: N/A
Substitutions: N/A
Possession: N/A
Free Kicks: N/A
Goal Kicks: N/A
Throw Ins: N/A
Offsides: N/A
Corners: N/A
Shots on Target: N/A
Shots off Target: N/A
Attempts on Goal: N/A
Saves: N/A
Fouls: N/A
Treatments: N/A
Penalties: N/A
Shots Blocked: N/A
Dangerous Attacks: N/A
Attacks: N/A
`;
      ctx.reply("⚽️ Match not yet live.");
    }

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "📊 Dexscreener",
            url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
          },
          { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
        ],
      ],
    };

    bot.telegram.sendPhoto(
      ctx.chat.id,
      {
        source: "euro-logo.png",
      },
      {
        caption: statsMessage,
        parse_mode: "HTML",
        reply_markup: inlineKeyboard,
      }
    );
  } catch (error) {
    console.error("Error fetching live match data:", error);
    ctx.reply("⚠️ An error occurred while fetching live match data.");
  }
}

bot.command("euro_live", async (ctx) => {
  await sendStatistics(ctx);
});

bot.command("euro_fixtures", async (ctx) => {
  try {
    const matchesData = await fs.readFile("match-schedule.json", "utf-8");
    const matches = JSON.parse(matchesData);

    if (!matches || matches.length === 0) {
      ctx.reply("📅 No scheduled matches found.");
      return;
    }

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "📊 Dexscreener",
            url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
          },
          { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
        ],
      ],
    };

    let messageChunks = [];
    let message = "📅 <b>EURO 2024 Fixtures</b>\n\n";
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      message += `🏟️ <b>${match.HomeTeam}</b> vs <b>${
        match.AwayTeam
      }</b>\n📆 Date: ${new Date(
        match.DateUtc
      ).toLocaleDateString()} \n⏰ Time: ${new Date(
        match.DateUtc
      ).toLocaleTimeString()} \n📍 Location: ${match.Location} ${
        match.Group == null ? "" : `\n🎉 Group: ${match.Group}`
      }\n\n`;

      // Split message into chunks of 5 matches each
      if ((i + 1) % 5 === 0 || i === matches.length - 1) {
        messageChunks.push(message);
        message = "";
      }
    }

    // Send the first batch with the image
    if (messageChunks.length > 0) {
      await bot.telegram.sendPhoto(
        ctx.chat.id,
        { source: "euro-logo.png" },
        {
          caption: messageChunks[0],
          parse_mode: "HTML",
        }
      );
    }

    // Send remaining batches without image
    for (let i = 1; i < messageChunks.length - 1; i++) {
      await bot.telegram.sendMessage(ctx.chat.id, messageChunks[i], {
        parse_mode: "HTML",
      });
    }

    // Send the last batch with buttons
    if (messageChunks.length > 1) {
      await bot.telegram.sendMessage(
        ctx.chat.id,
        messageChunks[messageChunks.length - 1],
        {
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        }
      );
    }
  } catch (error) {
    console.error("Error fetching match schedule:", error);
    ctx.reply("⚠️ An error occurred while fetching match schedule.");
  }
});

bot.command("euro_standings", async (ctx) => {
  try {
    const standingsData = await fs.readFile("standings.json", "utf-8");
    const data = JSON.parse(standingsData);

    if (!data || !data.standings) {
      ctx.reply("🏆 Standings not available.");
      return;
    }

    const standings = data.standings;
    let messageChunks = [];
    let message = "🏆 <b>Teams' Previous Standings</b>\n\n";

    for (const group of standings) {
      message += `<b>${group.group.toUpperCase()}</b>\n------&lt;&gt;------------------------\n\n`;

      for (const team of group.teams) {
        message += `<b>${team.position}. ${team.name}</b> - ${team.points} pts\n`;
        message += `Matches Played: ${team.matches_played}, Wins: ${team.wins}\n`;
        message += `Draws: ${team.draws}, Losses: ${team.losses}\n`;
        message += `Goals For: ${team.goals_for}, Goals Against: ${team.goals_against}\n`;
        message += `Goal Difference: ${team.goal_difference}\n\n`;
      }

      // Split message into chunks of 5 groups each
      if (messageChunks.length === 0 || message.split("\n").length >= 5) {
        messageChunks.push(message);
        message = "";
      }
    }

    // Send the first batch with the image
    if (messageChunks.length > 0) {
      await bot.telegram.sendPhoto(
        ctx.chat.id,
        { source: "euro-logo.png" },
        {
          caption: messageChunks[0],
          parse_mode: "HTML",
        }
      );
    }

    // Send remaining batches without image
    for (let i = 1; i < messageChunks.length - 1; i++) {
      await bot.telegram.sendMessage(ctx.chat.id, messageChunks[i], {
        parse_mode: "HTML",
      });
    }

    // Send the last batch with buttons
    if (messageChunks.length > 1) {
      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: "📊 Dexscreener",
              url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
            },
            { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
          ],
        ],
      };

      await bot.telegram.sendMessage(
        ctx.chat.id,
        messageChunks[messageChunks.length - 1],
        {
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        }
      );
    }
  } catch (error) {
    console.error("Error fetching standings:", error);
    ctx.reply("⚠️ An error occurred while fetching standings.");
  }
});

// Command to get team information
bot.command("euro_teams_info", async (ctx) => {
  try {
    // Load team data from JSON file
    const rawData = await fs.readFile("team-info.json", "utf-8");
    const teamData = JSON.parse(rawData);

    if (!teamData || !teamData.teams || teamData.teams.length === 0) {
      ctx.reply("⚽ No team information found.");
      return;
    }

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "📊 Dexscreener",
            url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
          },
          { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
        ],
      ],
    };

    let messageChunks = [];
    let message = "<b>⚽ Euro 2024 Teams Information ⚽</b>\n\n";
    for (let i = 0; i < teamData.teams.length; i++) {
      const team = teamData.teams[i];
      message += `<b>${i + 1}. ${team.name.toUpperCase()}</b>\n`;
      message += `🌍 Group: ${team.group}\n`;
      message += `👔 Coach: ${team.coach}\n-----------------------------------------------\n`;
      message += "🏆 Euro Best:\n";
      team.pedigree["Euro best"].forEach((achievement) => {
        message += `---- ${achievement}\n`;
      });
      message += "-----------------------------------------------\n\n";

      // Split message into chunks of 4 teams each
      if ((i + 1) % 4 === 0 || i === teamData.teams.length - 1) {
        messageChunks.push(message);
        message = "";
      }
    }

    // Send the first batch with the image
    if (messageChunks.length > 0) {
      await bot.telegram.sendPhoto(
        ctx.chat.id,
        { source: "euro-logo.png" },
        {
          caption: messageChunks[0],
          parse_mode: "HTML",
        }
      );
    }

    // Send remaining batches without image
    for (let i = 1; i < messageChunks.length - 1; i++) {
      await bot.telegram.sendMessage(ctx.chat.id, messageChunks[i], {
        parse_mode: "HTML",
      });
    }

    // Send the last batch with buttons
    if (messageChunks.length > 1) {
      await bot.telegram.sendMessage(
        ctx.chat.id,
        messageChunks[messageChunks.length - 1],
        {
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        }
      );
    }
  } catch (error) {
    console.error("Error fetching team information:", error);
    ctx.reply(
      "⚠️ An error occurred while fetching team information. Please try again later."
    );
  }
});

const loadBotAdmins = async () => {
  try {
    const data = await fs.readFile("bot-admins.json", "utf8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

const saveBotAdmins = async (admins) => {
  try {
    await fs.writeFile("bot-admins.json", JSON.stringify(admins));
  } catch (error) {
    console.error("Error saving bot admins:", error);
    throw error;
  }
};

const informBotAdmin = async (ctx, message) => {
  try {
    const admins = await loadBotAdmins();
    if (admins.length > 0) {
      for (const admin of admins) {
        if (admin !== ctx.chat.id) {
          await bot.telegram.sendMessage(admin, message);
        }
      }
    }
  } catch (error) {
    console.error("Error sending update to creator:", error);
  }
};

const loadMatches = async () => {
  try {
    const data = await fs.readFile("match-schedule.json", "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading matches:", error);
    return [];
  }
};

// Calculate countdown to the next match
const getMatchCountdown = (matchDate) => {
  const now = new Date();
  const matchTime = new Date(matchDate);
  const diff = matchTime - now;

  if (diff <= 0) {
    return null;
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return { hours, minutes };
};

// Send countdown updates to subscribers
const sendMatchCountdownUpdates = async (recipientType) => {
  const matches = await loadMatches();
  const subscribers = await loadSubscribers();
  const now = new Date();

  const upcomingMatches = matches.filter((match) => {
    const matchTime = new Date(match.DateUtc);
    return matchTime > now;
  });

  if (upcomingMatches.length === 0) {
    return;
  }

  const nextMatch = upcomingMatches[0];
  const countdown = getMatchCountdown(nextMatch.DateUtc);

  if (!countdown) {
    return;
  }

  const message =
    `<b>EURO 2024</b>\n\n<b>${nextMatch.Group}\n⚽ Upcoming Match</b>\n\n` +
    `👥 <b>Teams:</b>\n${nextMatch.HomeTeam} vs ${nextMatch.AwayTeam}\n\n` +
    `⏰ <b>Starts in:</b>\n${countdown.hours} hours, ${countdown.minutes} minutes\n\n` +
    `📍 <b>Location:</b>\n${nextMatch.Location}`;

  if (recipientType === "group") {
    for (const groupId of subscribers.groups) {
      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: "📊 Dexscreener",
              url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
            },
            { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
          ],
        ],
      };

      bot.telegram.sendPhoto(
        groupId,
        {
          source: "euro-logo.png",
        },
        {
          caption: message,
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        }
      );
    }
  } else if (recipientType === "user") {
    for (const chatId of subscribers.users) {
      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: "📊 Dexscreener",
              url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
            },
            { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
          ],
        ],
      };

      bot.telegram.sendPhoto(
        chatId,
        {
          source: "euro-logo.png",
        },
        {
          caption: message,
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        }
      );
    }
  }
};

// Send live match update
const sendLiveMatchUpdateToGroups = async () => {
  try {
    // Load matches
    const matches = await loadMatches();

    // Get current time
    const now = new Date();

    // Check if there's a live match
    const liveMatch = matches.find((match) => {
      const matchTime = new Date(match.DateUtc);
      return (
        now >= matchTime &&
        now < new Date(matchTime.getTime() + 110 * 60 * 1000)
      );
    });

    if (liveMatch) {
      const matchInfo = await getMatchInfo(liveMatch.matchId);
      if (!matchInfo) {
        return;
      } else {
        const groupSubscribers = await loadSubscribers();
        for (const groupId of groupSubscribers.groups) {
          let statsMessage = `
<b>EURO 2024 Live Update</b>

-------------------------
🏟️ <b>${liveMatch.HomeTeam}</b> vs <b>${liveMatch.AwayTeam}</b>
👥 ${liveMatch.Group}
📍 ${liveMatch.Location}
-------------------------`;

          const goals = matchInfo.score;
          const stats = matchInfo.statistics;

          statsMessage += `
GOALS:  ${goals || "N/A"}
-------------------------

📊 <b>Match Statistics</b>

Yellow Cards: ${stats.yellow_cards}
Red Cards: ${stats.red_cards}
Substitutions: ${stats.substitutions}
Possession: ${stats.possesion}
Free Kicks: ${stats.free_kicks}
Goal Kicks: ${stats.goal_kicks}
Throw Ins: ${stats.throw_ins}
Offsides: ${stats.offsides}
Corners: ${stats.corners}
Shots on Target: ${stats.shots_on_target}
Shots off Target: ${stats.shots_off_target}
Attempts on Goal: ${stats.attempts_on_goal}
Saves: ${stats.saves}
Fouls: ${stats.fauls}
Treatments: ${stats.treatments}
Penalties: ${stats.penalties}
Shots Blocked: ${stats.shots_blocked}
Dangerous Attacks: ${stats.dangerous_attacks}
Attacks: ${stats.attacks}
`;

          const inlineKeyboard = {
            inline_keyboard: [
              [
                {
                  text: "📊 Dexscreener",
                  url: "https://dexscreener.com/solana/chrwlawxd2mmtavx5abpyajzqzak8jvfvbybwih3kqwk",
                },
                { text: "👥 Community", url: "https://t.me/EURO2024Solana" },
              ],
            ],
          };

          bot.telegram.sendPhoto(
            groupId,
            {
              source: "euro-logo.png",
            },
            {
              caption: statsMessage,
              parse_mode: "HTML",
              reply_markup: inlineKeyboard,
            }
          );
        }
      }
    }
  } catch (error) {
    console.error("Error sending live match update:", error);
  }
};

// Start cron jobs for sending countdown updates
const startCountdownCronJobs = () => {
  cron.schedule("*/10 * * * *", async () => {
    await sendMatchCountdownUpdates("group");
  });

  cron.schedule("0 * * * *", async () => {
    await sendMatchCountdownUpdates("user");
  });

  console.log("Countdown cron jobs started");
};

// Start cron job to send update for live matches to groups
const startLiveMatchUpdateCronJob = () => {
  cron.schedule("* * * * *", async () => {
    await sendLiveMatchUpdateToGroups();
  });

  console.log("Live match updater started.");
};

// Initialize all cron jobs
startCountdownCronJobs();
startLiveMatchUpdateCronJob();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Launch the bot
bot.launch();
