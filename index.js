const express = require("express");
const { Telegraf, Scenes, session } = require("telegraf");
const cron = require("node-cron");
const axios = require("axios");
// const fs = require("fs").promises;

const {
  Subscriber,
  BotAdmin,
  sequelize,
  BotAdminRequest,
} = require("./models");

require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const BOT_ADMIN_PASSWORD = process.env.BOT_ADMIN_PASSWORD;
const HOST = process.env.HOST;
const LIVE_SCORE_API_KEY = process.env.LIVE_SCORE_API_KEY;
const LIVE_SCORE_SECRET_KEY = process.env.LIVE_SCORE_SECRET_KEY;
const EURO_LIVE_MATCH = `https://livescore-api.com/api-client/matches/live.json?key=${LIVE_SCORE_API_KEY}&secret=${LIVE_SCORE_SECRET_KEY}&competition_id=387`;

const base64EuroLogo = require("./encoded-euro-logo.js");
const matchSchedule = require("./match-schedule.js");
const teamStandings = require("./team-standings.js");
const teamsInfo = require("./team-info.js");

const bot = new Telegraf(BOT_TOKEN);

// Set up Express
const app = express();
app.use(express.json());

// // Set webhook
bot.telegram
  .setWebhook(`${HOST}/bot${BOT_TOKEN}`)
  .then(() => {
    console.log("Telegram Webhook set successfully.");
  })
  .catch((error) => {
    console.error("Error setting Telegram Webhook", error);
  });

// Webhook endpoint
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.get("/", (req, res) => {
  console.log("This is EURO 2024 Bot endpoint");
  res.send("<b>This is EURO 2024 Bot endpoint</b>");
});

const sleep = async (timeout) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
};

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
    { command: "set_bot_admin", description: "Set Bot Admin" },
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

const subscribeGroup = async (ctx, groupId) => {
  try {
    const [subscriber, created] = await Subscriber.findOrCreate({
      where: { chatId: groupId, type: "group" },
    });

    if (created) {
      await ctx.reply("Subscription successful.");
      await informBotAdmins(
        ctx,
        `A group just subscribed to EURO 2024 Messenger.\n\nDetails:\nUsername: ${
          !ctx.chat.username ? "Not available" : "@" + ctx.chat.username
        }\nTitle: ${ctx.chat.title}`
      );
    } else {
      ctx.reply("Group currently subscribed.");
    }
  } catch (error) {
    console.error("Error subscribing group:", error);
  }
};

const unsubscribeGroup = async (ctx, groupId) => {
  try {
    const result = await Subscriber.destroy({
      where: { chatId: groupId, type: "group" },
    });

    if (result) {
      await ctx.reply("Group unsubscribed successfully.");
      await informBotAdmins(
        ctx,
        `A group just unsubscribed from EURO 2024 Messenger.\n\nDetails:\nUsername: ${
          !ctx.chat.username ? "Not available" : "@" + ctx.chat.username
        }\nTitle: ${ctx.chat.title}`
      );
    } else {
      ctx.reply("Group is currently unsubscribed.");
    }
  } catch (error) {
    console.error("Error unsubscribing group:", error);
  }
};

const subscribeUser = async (ctx, chatId) => {
  try {
    const [subscriber, created] = await Subscriber.findOrCreate({
      where: { chatId, type: "user" },
    });

    if (created) {
      await ctx.reply("Subscription successful.");
      await informBotAdmins(
        ctx,
        `A Telegram User just subscribed to EURO 2024 Messenger.\n\nDetails:\nName:${
          ctx.chat.first_name
        } ${
          (ctx.chat.last_name && ctx.chat.last_name) || "Not available"
        }\nUsername: ${
          (ctx.message.from.username && "@" + ctx.message.from.username) ||
          "Not available"
        } `
      );
    } else {
      ctx.reply("You're currently subscribed.");
    }
  } catch (error) {
    console.error("Error subscribing user:", error);
  }
};

const unsubscribeUser = async (ctx, chatId) => {
  try {
    const result = await Subscriber.destroy({
      where: { chatId, type: "user" },
    });

    if (result) {
      await ctx.reply("You have unsubscribed successfully.");
      await informBotAdmins(
        ctx,
        `A User just unsubscribed from EURO 2024 Messenger.\n\nDetails:\nName:${
          ctx.chat.first_name
        } ${
          (ctx.chat.last_name && ctx.chat.last_name) || "Not available"
        }\nUsername: ${
          (ctx.message.from.username && "@" + ctx.message.from.username) ||
          "Not available"
        } `
      );
    } else {
      ctx.reply("You're currently unsubscribed.");
    }
  } catch (error) {
    console.error("Error unsubscribing user:", error);
  }
};

const loadSubscribers = async () => {
  try {
    const users = await Subscriber.findAll({ where: { type: "user" } });
    const groups = await Subscriber.findAll({ where: { type: "group" } });

    return {
      users: users.map((user) => user.chatId),
      groups: groups.map((group) => group.chatId),
    };
  } catch (error) {
    console.error("Error loading subscribers:", error);
    return { users: [], groups: [] };
  }
};

// Command handlers
bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId > 0) {
    try {
      const [_, created] = await Subscriber.findOrCreate({
        where: { chatId, type: "user" },
      });

      if (created) {
        await informBotAdmins(
          ctx,
          `A Telegram User just subscribed to EURO 2024 Messenger.\n\nDetails:\nName:${
            ctx.chat.first_name
          } ${
            (ctx.chat.last_name && ctx.chat.last_name) || "Not available"
          }\nUsername: ${
            (ctx.message.from.username && "@" + ctx.message.from.username) ||
            "Not available"
          } `
        );
      }
    } catch (error) {
      console.error(
        "Error creating subscriber and informing bot admins:",
        error
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
        source: Buffer.from(base64EuroLogo(), "base64"),
      },
      {
        caption: message,
        parse_mode: "HTML",
        reply_markup: inlineKeyboard,
      }
    );
  }
});

// Function to check if a user is an admin
async function isAdmin(ctx, chatId, userId) {
  const admins = await ctx.telegram.getChatAdministrators(chatId);
  return admins.some((admin) => admin.user.id === userId);
}

bot.command("euro_subscribe", async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.message.from.id;

  if (chatId > 0) {
    // This is a private chat
    await subscribeUser(ctx, chatId);
  } else {
    // This is a group chat
    const userIsAdmin = await isAdmin(ctx, chatId, userId);
    if (userIsAdmin) {
      await subscribeGroup(ctx, chatId);
    } else {
      ctx.reply(
        "🚫 This command is only for group admins, but you can message me privately to access it."
      );
    }
  }
});

bot.command("euro_unsubscribe", async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.message.from.id;

  if (chatId > 0) {
    // This is a private chat
    await unsubscribeUser(ctx, chatId);
  } else {
    // This is a group chat
    const userIsAdmin = await isAdmin(ctx, chatId, userId);
    if (userIsAdmin) {
      await unsubscribeGroup(ctx, chatId);
    } else {
      ctx.reply(
        "🚫 This command is only for group admins, but you can message me privately to access it."
      );
    }
  }
});

const setPasswordScene = new Scenes.BaseScene("setPassword");

setPasswordScene.on("text", async (ctx) => {
  const password = ctx.message.text;
  const userId = ctx.from.id.toString();

  const isPasswordValid = password === BOT_ADMIN_PASSWORD;

  if (isPasswordValid) {
    const [admin, created] = await BotAdmin.findOrCreate({
      where: { chatId: userId },
    });
    ctx.reply(
      created ? "You have been added as an admin." : "You're already an admin."
    );

    await BotAdminRequest.destroy({ where: { userId } });
  } else {
    ctx.reply("Incorrect password. Please try again.");
  }

  // Leave the scene after password handling
  ctx.scene.leave();
});

// Create the stage and register the scene
const stage = new Scenes.Stage([setPasswordScene]);

bot.use(session());
bot.use(stage.middleware());

// Bot command to initiate the admin setup
bot.command("set_bot_admin", async (ctx) => {
  const userId = ctx.from.id.toString();
  const existingRequest = await BotAdminRequest.findOne({ where: { userId } });
  if (existingRequest) {
    ctx.reply("Enter correct password:");
  } else {
    setPasswordScene.enter((ctx) => {
      ctx.reply("Enter correct password:");
    });

    await BotAdminRequest.create({ userId });
  }
  ctx.scene.enter("setPassword");
});

async function getMatchInfo() {
  try {
    // Fetch match scores from the API
    const liveMatchResponse = await axios.get(EURO_LIVE_MATCH);
    const matches = liveMatchResponse.data.data.match;
    const liveMatch = matches[matches.length - 1];

    // Fetch match statistics from the API
    const statisticsUrl = `${liveMatch.urls.statistics}&key=${LIVE_SCORE_API_KEY}&secret=${LIVE_SCORE_SECRET_KEY}`;
    const statisticsResponse = await axios.get(statisticsUrl);
    const statistics = statisticsResponse.data.data;

    console.log(statisticsResponse);
    console.log(liveMatchResponse);

    // Check if both requests were successful
    if (liveMatchResponse.data.success && statisticsResponse.data.success) {
      return {
        score: liveMatch.scores.score,
        statistics: statistics,
      };
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error fetching match information:", error);
    return false;
  }
}

async function sendStatistics(ctx) {
  try {
    const matches = matchSchedule;

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
      const matchInfo = await getMatchInfo();

      if (matchInfo == false) {
        ctx.reply("⚠️ Failed to retrieve match data.");
        return;
      }

      const goals = matchInfo.score;
      const stats = matchInfo.statistics;

      statsMessage += `
GOALS:  ${goals || "N/A"}
-------------------------

📊 <b>Match Statistics</b>

Yellow Cards: ${stats.yellow_cards || "N/A"}
Red Cards: ${stats.red_cards || "N/A"}
Substitutions: ${stats.substitutions || "N/A"}
Possession: ${stats.possesion || "N/A"}
Free Kicks: ${stats.free_kicks || "N/A"}
Goal Kicks: ${stats.goal_kicks || "N/A"}
Throw Ins: ${stats.throw_ins || "N/A"}
Offsides: ${stats.offsides || "N/A"}
Corners: ${stats.corners || "N/A"}
Shots on Target: ${stats.shots_on_target || "N/A"}
Shots off Target: ${stats.shots_off_target || "N/A"}
Attempts on Goal: ${stats.attempts_on_goal || "N/A"}
Saves: ${stats.saves || "N/A"}
Fouls: ${stats.fauls || "N/A"}
Treatments: ${stats.treatments || "N/A"}
Penalties: ${stats.penalties || "N/A"}
Shots Blocked: ${stats.shots_blocked || "N/A"}
Dangerous Attacks: ${stats.dangerous_attacks || "N/A"}
Attacks: ${stats.attacks || "N/A"}
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
        source: Buffer.from(base64EuroLogo(), "base64"),
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
  const chatId = ctx.chat.id;
  const userId = ctx.message.from.id;

  if (chatId < 0) {
    const userIsAdmin = await isAdmin(ctx, chatId, userId);
    if (!userIsAdmin) {
      ctx.reply(
        "🚫 This command is only for group admins, but you can message me privately to access it."
      );

      return;
    }
  }
  try {
    const matches = matchSchedule;

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
      ).toLocaleTimeString()} UTC \n📍 Location: ${match.Location} ${
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
      await sleep(300);
      await bot.telegram.sendPhoto(
        ctx.chat.id,
        { source: Buffer.from(base64EuroLogo(), "base64") },
        {
          caption: messageChunks[0],
          parse_mode: "HTML",
        }
      );
    }

    // Send remaining batches without image
    for (let i = 1; i < messageChunks.length - 1; i++) {
      await sleep(300);
      await bot.telegram.sendMessage(ctx.chat.id, messageChunks[i], {
        parse_mode: "HTML",
      });
    }

    // Send the last batch with buttons
    if (messageChunks.length > 1) {
      await sleep(300);
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
  const chatId = ctx.chat.id;
  const userId = ctx.message.from.id;

  if (chatId < 0) {
    // This is a group chat
    const userIsAdmin = await isAdmin(ctx, chatId, userId);
    if (!userIsAdmin) {
      ctx.reply(
        "🚫 This command is only for group admins, but you can message me privately to access it."
      );

      return;
    }
  }
  try {
    const standings = teamStandings.standings;
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
      await sleep(300);
      await bot.telegram.sendPhoto(
        ctx.chat.id,
        { source: Buffer.from(base64EuroLogo(), "base64") },
        {
          caption: messageChunks[0],
          parse_mode: "HTML",
        }
      );
    }

    // Send remaining batches without image
    for (let i = 1; i < messageChunks.length - 1; i++) {
      await sleep(300);
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
  const chatId = ctx.chat.id;
  const userId = ctx.message.from.id;

  if (chatId < 0) {
    // This is a group chat
    const userIsAdmin = await isAdmin(ctx, chatId, userId);
    if (!userIsAdmin) {
      ctx.reply(
        "🚫 This command is only for group admins, but you can message me privately to access it."
      );

      return;
    }
  }
  try {
    const teamsData = teamsInfo;

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
    for (let i = 0; i < teamsData.teams.length; i++) {
      const team = teamsData.teams[i];
      message += `<b>${i + 1}. ${team.name.toUpperCase()}</b>\n`;
      message += `🌍 Group: ${team.group}\n`;
      message += `👔 Coach: ${team.coach}\n-----------------------------------------------\n`;
      message += "🏆 Euro Best:\n";
      team.pedigree["Euro best"].forEach((achievement) => {
        message += `---- ${achievement}\n`;
      });
      message += "-----------------------------------------------\n\n";

      // Split message into chunks of 4 teams each
      if ((i + 1) % 4 === 0 || i === teamsData.teams.length - 1) {
        messageChunks.push(message);
        message = "";
      }
    }

    // Send the first batch with the image
    if (messageChunks.length > 0) {
      await sleep(300);
      await bot.telegram.sendPhoto(
        ctx.chat.id,
        { source: Buffer.from(base64EuroLogo(), "base64") },
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
      await sleep(300);
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

bot.command("list_subscribers", async (ctx) => {
  const chatId = ctx.chat.id;

  if (chatId > 0) {
    // This is a private chat
    const adminList = await loadBotAdmins();

    if (!adminList.includes(chatId.toString())) {
      ctx.reply("🚫 This command is only for admins.");
      return;
    }
  }

  try {
    const subscribers = await loadSubscribers();
    const userSubscribers = subscribers.users;
    const groupSubscribers = subscribers.groups;

    let userList = `<b>User Subscribers:</b>\n\n`;

    for (const userSubscriber of userSubscribers) {
      try {
        const chat = await bot.telegram.getChat(userSubscriber);
        userList += `Name: ${chat.first_name || "N/A"} ${
          chat.last_name || ""
        }\nUsername: ${chat.username ? "@" + chat.username : "N/A"}\n`;
      } catch (error) {
        console.error(
          `Error fetching chat info for user ${userSubscriber}:`,
          error
        );
      }
    }

    userList += `\n<b>Group Subscribers:</b>\n\n`;

    for (const groupSubscriber of groupSubscribers) {
      try {
        const chat = await bot.telegram.getChat(groupSubscriber);
        userList += `Group Name: ${chat.title}\nUsername: ${
          chat.username ? "@" + chat.username : "N/A"
        }\n`;
      } catch (error) {
        console.error(
          `Error fetching chat info for group ${groupSubscriber}:`,
          error
        );
      }
    }

    ctx.reply(userList, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error fetching subscribers:", error);
    ctx.reply("⚠️ An error occurred while fetching subscribers.");
  }
});

const loadBotAdmins = async () => {
  try {
    const admins = await BotAdmin.findAll({
      attributes: ["chatId"], // Only fetch the chatId column
    });

    // Map the result to an array of chat IDs
    return admins.map((admin) => admin.chatId);
  } catch (error) {
    console.error("Error loading bot admins:", error);
    return [];
  }
};

const informBotAdmins = async (ctx, message) => {
  try {
    const admins = await loadBotAdmins();
    if (admins.length > 0) {
      for (const admin of admins) {
        if (!admins.includes(ctx.chat.id.toString())) {
          await bot.telegram.sendMessage(admin, message);
        }
      }
    }
  } catch (error) {
    console.error("Error sending update to admin:", error);
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

let liveMatchEndTime = null;

// Send countdown updates to subscribers
const sendMatchCountdownUpdates = async (recipientType) => {
  const matches = matchSchedule;
  const subscribers = await loadSubscribers();
  const now = new Date().getTime();

  // Check if there's a currently live match
  if (liveMatchEndTime && now < liveMatchEndTime) {
    return; // A match is currently live, so don't send new upcoming match updates
  }

  // Reset the live match end time if past it
  if (liveMatchEndTime && now >= liveMatchEndTime) {
    liveMatchEndTime = null;
  }

  // Sort matches by DateUtc to ensure the first upcoming match is the earliest one
  matches.sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));

  const upcomingMatches = matches.filter((match) => {
    const matchTime = new Date(match.DateUtc).getTime();
    return matchTime > now;
  });

  if (upcomingMatches.length === 0) {
    return;
  }

  const nextMatch = upcomingMatches[0];
  const nextMatchTime = new Date(nextMatch.DateUtc).getTime();

  // Set the live match end time
  if (
    now >= nextMatchTime - 2 * 60 * 1000 &&
    now < nextMatchTime + 110 * 60 * 1000
  ) {
    liveMatchEndTime = nextMatchTime + 110 * 60 * 1000;
    return; // The match is starting soon or currently live, stop sending countdown updates
  }

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
          source: Buffer.from(base64EuroLogo(), "base64"),
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
          source: Buffer.from(base64EuroLogo(), "base64"),
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
    const matches = matchSchedule;

    // Sort matches by DateUtc to ensure the first live match is the earliest one
    matches.sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));

    // Get current time
    const now = new Date().getTime();

    // Check if there's a live match
    const liveMatch = matches.find((match) => {
      const matchTime = new Date(match.DateUtc).getTime();
      return (
        now >= matchTime + 2 * 60 * 1000 && now < matchTime + 110 * 60 * 1000
      );
    });

    if (liveMatch) {
      const matchInfo = await getMatchInfo();
      if (matchInfo == false) {
        return;
      }

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

Yellow Cards: ${stats.yellow_cards || "N/A"}
Red Cards: ${stats.red_cards || "N/A"}
Substitutions: ${stats.substitutions || "N/A"}
Possession: ${stats.possession || "N/A"}
Free Kicks: ${stats.free_kicks || "N/A"}
Goal Kicks: ${stats.goal_kicks || "N/A"}
Throw Ins: ${stats.throw_ins || "N/A"}
Offsides: ${stats.offsides || "N/A"}
Corners: ${stats.corners || "N/A"}
Shots on Target: ${stats.shots_on_target || "N/A"}
Shots off Target: ${stats.shots_off_target || "N/A"}
Attempts on Goal: ${stats.attempts_on_goal || "N/A"}
Saves: ${stats.saves || "N/A"}
Fouls: ${stats.fouls || "N/A"}
Treatments: ${stats.treatments || "N/A"}
Penalties: ${stats.penalties || "N/A"}
Shots Blocked: ${stats.shots_blocked || "N/A"}
Dangerous Attacks: ${stats.dangerous_attacks || "N/A"}
Attacks: ${stats.attacks || "N/A"}
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

        try {
          await bot.telegram.sendPhoto(
            groupId,
            {
              source: Buffer.from(base64EuroLogo(), "base64"),
            },
            {
              caption: statsMessage,
              parse_mode: "HTML",
              reply_markup: inlineKeyboard,
            }
          );
        } catch (error) {
          console.error(`Error sending photo to group ${groupId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("Error sending live match update:", error);
  }
};

// Start cron jobs for sending countdown updates
const startCountdownCronJobs = () => {
  cron.schedule("*/30 * * * *", async () => {
    await sendMatchCountdownUpdates("group");
  });

  cron.schedule("0 * * * *", async () => {
    await sendMatchCountdownUpdates("user");
  });

  console.log("Countdown cron jobs started");
};

// Start cron job to send update for live matches to groups
const startLiveMatchUpdateCronJob = () => {
  cron.schedule("*/3 * * * *", async () => {
    await sendLiveMatchUpdateToGroups();
  });

  console.log("Live match updater started.");
};

// Initialize all cron jobs
startCountdownCronJobs();
startLiveMatchUpdateCronJob();

sequelize
  .authenticate()
  .then(() => {
    console.log("Database connection established successfully.");
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Unable to connect to the database:", err);
  });
