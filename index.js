const { Client, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
require("dotenv").config();

// ----------- CLIENT SETUP ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ----------- KEEP ALIVE SERVER ----------
const app = express();
app.get("/", (req, res) => res.send("Bot is Alive!"));
app.listen(3000, () => console.log("Uptime server online"));

// ----------- SLASH COMMAND /verify ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "verify") {
    return interaction.reply({
      content: "📸 **Apna screenshot verification channel me bhejein!**",
      ephemeral: true
    });
  }
});

// ----------- MESSAGE BASED VERIFICATION ----------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const screenshotChannel = process.env.SCREENSHOT_CHANNEL_ID;
  const giveRole = process.env.ROLE_ID;

  if (msg.channel.id !== screenshotChannel) return;

  const attachment = msg.attachments.first();
  if (!attachment)
    return msg.reply("❌ Screenshot send karo.");

  const url = attachment.url;

  // Block videos
  if (
    url.endsWith(".mp4") ||
    url.endsWith(".mov") ||
    url.endsWith(".webm") ||
    url.includes("video")
  ) {
    return msg.reply("❌ Sirf image allow hai. Video mat bhejo.");
  }

  // Only allow images
  if (
    !url.endsWith(".png") &&
    !url.endsWith(".jpg") &&
    !url.endsWith(".jpeg")
  ) {
    return msg.reply("❌ Ye image file nahi lag rahi.");
  }

  const role = msg.guild.roles.cache.get(giveRole);

  try {
    await msg.member.roles.add(role);
    msg.reply("✅ Verified! Aapko role mil gaya.");
  } catch (err) {
    console.log(err);
    msg.reply("❌ Role nahi de paaya. Bot ke permissions check karo.");
  }
});

// ----------- LOGIN ----------
client.login(process.env.TOKEN);
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
require("dotenv").config();

// ----------- CLIENT SETUP ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ----------- KEEP ALIVE SERVER ----------
const app = express();
app.get("/", (req, res) => res.send("Bot is Alive!"));
app.listen(3000, () => console.log("Uptime server online"));

// ----------- SLASH COMMAND /verify ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "verify") {
    return interaction.reply({
      content: "📸 **Apna screenshot verification channel me bhejein!**",
      ephemeral: true
    });
  }
});

// ----------- MESSAGE BASED VERIFICATION ----------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const screenshotChannel = process.env.SCREENSHOT_CHANNEL_ID;
  const giveRole = process.env.ROLE_ID;

  if (msg.channel.id !== screenshotChannel) return;

  const attachment = msg.attachments.first();
  if (!attachment)
    return msg.reply("❌ Screenshot send karo.");

  const url = attachment.url;

  // Block videos
  if (
    url.endsWith(".mp4") ||
    url.endsWith(".mov") ||
    url.endsWith(".webm") ||
    url.includes("video")
  ) {
    return msg.reply("❌ Sirf image allow hai. Video mat bhejo.");
  }

  // Only allow images
  if (
    !url.endsWith(".png") &&
    !url.endsWith(".jpg") &&
    !url.endsWith(".jpeg")
  ) {
    return msg.reply("❌ Ye image file nahi lag rahi.");
  }

  const role = msg.guild.roles.cache.get(giveRole);

  try {
    await msg.member.roles.add(role);
    msg.reply("✅ Verified! Aapko role mil gaya.");
  } catch (err) {
    console.log(err);
    msg.reply("❌ Role nahi de paaya. Bot ke permissions check karo.");
  }
});

// ----------- LOGIN ----------
client.login(process.env.TOKEN);
