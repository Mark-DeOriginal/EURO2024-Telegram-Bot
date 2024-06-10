const express = require("express");
const { Telegraf } = require("telegraf");
const fs = require("fs").promises;
const cron = require("node-cron");
require("dotenv").config();

// Replace with your bot token
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST;

const bot = new Telegraf(BOT_TOKEN);
let cronJob;

// Set up Express
const app = express();
app.use(express.json());

// Set webhook
bot.telegram.setWebhook(`${HOST}/bot${BOT_TOKEN}`);

// Set commands for private chats
bot.telegram.setMyCommands(
  [
    { command: "start", description: "Start \nEURO 2024 Messenger" },
    { command: "help", description: "Display guide" },
    { command: "euro_subscribe", description: "Subscribe to updates" },
    { command: "euro_unsubscribe", description: "Unsubscribe from updates" },
  ],
  { scope: { type: "all_private_chats" } }
);

// Set commands for group chats
bot.telegram.setMyCommands(
  [
    { command: "euro_subscribe", description: "Subscribe to updates" },
    { command: "euro_unsubscribe", description: "Unsubscribe from updates" },
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

// Call setWebhook once when the server starts
setWebhook();

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

    ctx.reply("Group has already subscribed.");
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
      ctx.reply("Unsubscription successful.");
      await informBotAdmin(
        ctx,
        `A group just unsubscribed from \nEURO 2024 Messenger.\n\nDetails:\nUsername: ${
          !ctx.chat.username ? "Not available" : "@" + ctx.chat.username
        } \nTitle: ${ctx.chat.title}`
      );
      return;
    }

    ctx.reply("Group not in subscription list.");
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

    ctx.reply("You're already subscribed.");
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

    ctx.reply("You're not in the subscription list.");
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

const handleSubscriptionEvent = async () => {
  try {
    const subscribers = await loadSubscribers();
    if (subscribers.groups.length === 0 && subscribers.users.length === 0) {
      stopCronJob();
      console.log("Periodic updates stopped.");
    } else {
      startCronJob();
      console.log("Periodic updates started.");
    }
  } catch (error) {
    console.error("Error handling subscription event:", error);
  }
};

// Command handlers
bot.command("start", (ctx) => {
  ctx.reply(
    `Hey there! 👋

<b>I am EURO 2024 Messenger</b>

Want me to keep your group updated about EURO 2024?

1. <b>Add me to your Group</b> 
    - Add @euro_messenger_bot to your group.

2. <b>Make me an Admin</b>
    - I need to be an Admin to interact with your group.

3. <b>Subscribe for Updates</b>
    - Send /euro_subscribe in your group to Subscribe and stay updated.

4. <b>Unsubscribe from Updates</b>
    - To unsubscribe, simply go to your group and send /euro_unsubscribe.

That's it! 🎉

Thank you for choosing Euro 2024 Messenger! ⚽️🏆`,
    { parse_mode: "HTML" }
  );
});

bot.command("help", (ctx) => {
  ctx.reply(
    `Available group commands:

/euro_subscribe

/euro_unsubscribe`,
    { parse_mode: "HTML" }
  );
});

bot.command("euro_subscribe", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId > 0) {
    await subscribeUser(ctx, chatId);
    await handleSubscriptionEvent();
  } else {
    const groupId = ctx.chat.id;
    await subscribeGroup(ctx, groupId);
    await handleSubscriptionEvent();
  }
});

bot.command("euro_unsubscribe", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId > 0) {
    await unsubscribeUser(ctx, chatId);
    await handleSubscriptionEvent();
  } else {
    const groupId = ctx.chat.id;
    await unsubscribeGroup(ctx, groupId);
    await handleSubscriptionEvent();
  }
});

bot.command("set_bot_admin", async (ctx) => {
  const password = process.env.BOT_ADMIN_PASSWORD;
  const userPassword = ctx.message.text.replace("/set_bot_admin ", "");
  if (ctx.chat.id > 0) {
    if (userPassword === password) {
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

const startCronJob = async () => {
  if (!cronJob) {
    cronJob = cron.schedule("*/10 * * * * *", sendUpdateToSubscribers); // Runs every 10 seconds
    console.log("Cron job started");
  }
};

const stopCronJob = () => {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("Cron job stopped");
  }
};

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

const getUpdate = () => {
  return "Hello, trust you're doing fine.";
};

const sendUpdateToSubscribers = async () => {
  try {
    const subscribers = await loadSubscribers();
    if (subscribers.groups.length > 0) {
      for (const groupId of subscribers.groups) {
        await bot.telegram.sendMessage(groupId, getUpdate());
      }
    }
    if (subscribers.users.length > 0) {
      for (const chatId of subscribers.users) {
        await bot.telegram.sendMessage(chatId, getUpdate());
      }
    }
  } catch (error) {
    console.error("Error sending update to subscribers:", error);
  }
};

// Start the cron job if there are existing subscribers
handleSubscriptionEvent();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
