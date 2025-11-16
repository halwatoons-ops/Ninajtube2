const { 
  Client, 
  GatewayIntentBits, 
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const express = require("express");
require("dotenv").config();

// ------------ HARD CODED IDS ------------
const SCREENSHOT_CHANNEL_ID = "1419946977944272947";
const ROLE_ID = "1439606789233578055";
const CLIENT_ID = "1439605306396119160";
const GUILD_ID = "1416693493958447167";

// ------------ DISCORD CLIENT ------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ------------ KEEP ALIVE ------------
const app = express();
app.get("/", (req, res) => res.send("Bot is Alive!"));
app.listen(3000, () => console.log("Uptime server online"));

// ------------ AUTO REGISTER SLASH COMMAND ----------
async function autoRegisterCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Start the verification process")
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Slash commands registered!");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// ------------ INTERACTION HANDLER ------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "verify") {
    return interaction.reply({
      content: "📸 **Verification channel me screenshot send karein!**",
      ephemeral: true
    });
  }
});

// ------------ MESSAGE HANDLER ------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

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
    msg.reply("✅ Verified! Aapko role mil gaya.");
  } catch (err) {
    console.log(err);
    msg.reply("❌ Role nahi de paaya. Bot permissions check karo.");
  }
});

// ------------ LOGIN ------------
client.login(process.env.TOKEN).then(() => {
  autoRegisterCommands(); // <-- Auto Slash Command Register
});
