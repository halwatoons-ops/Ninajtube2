const { Client, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
require("dotenv").config();

// ---------- HARD-CODED IDS ----------
const SCREENSHOT_CHANNEL_ID = "1419946977944272947";
const ROLE_ID = "1439606789233578055";

// ---------- CLIENT SETUP ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ---------- UPTIME SERVER ----------
const app = express();
app.get("/", (req, res) => res.send("Bot is Alive!"));
app.listen(3000, () => console.log("Uptime server online"));

// ---------- /verify COMMAND ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "verify") {
    return interaction.reply({
      content: "📸 **Verification channel me screenshot send karein!**",
      ephemeral: true
    });
  }
});

// ---------- MESSAGE VERIFICATION ----------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // Check if message is in screenshot channel
  if (msg.channel.id !== SCREENSHOT_CHANNEL_ID) return;

  const attachment = msg.attachments.first();
  if (!attachment)
    return msg.reply("❌ Screenshot bhejo.");

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

  const role = msg.guild.roles.cache.get(ROLE_ID);

  try {
    await msg.member.roles.add(role);
    msg.reply("✅ Verified! Role mil gaya.");
  } catch (err) {
    console.log(err);
    msg.reply("❌ Role nahi de paaya. Permissions check karo.");
  }
});

// ---------- LOGIN ----------
client.login(process.env.TOKEN);
