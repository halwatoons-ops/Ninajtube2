const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const express = require("express");
const fetch = require("node-fetch");
const Tesseract = require("tesseract.js");
require("dotenv").config();

// --------- HARD CODED IDs ---------
const ROLE_ID = "1439606789233578055";
const CLIENT_ID = "1439605306396119160";
const GUILD_ID = "1416693493958447167";

// --------- DISCORD CLIENT ---------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

// --------- KEEP ALIVE SERVER (Render + UptimeRobot) ---------
const app = express();
app.get("/", (req, res) => res.send("Bot is Alive!"));
app.listen(3000, () => console.log("Uptime server online"));

// --------- AUTO REGISTER SLASH COMMAND ---------
async function autoRegisterCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Upload a screenshot to verify your subscription.")
      .addAttachmentOption(option =>
        option.setName("screenshot")
          .setDescription("Upload your subscription screenshot here")
          .setRequired(true)
      )
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    console.log("Registering slash command...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Slash command registered!");
  } catch (err) {
    console.error("Failed to register command:", err);
  }
}

// --------- HANDLE /verify COMMAND ---------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "verify") return;

  const attachment = interaction.options.getAttachment("screenshot");

  // Must be a real image file
  if (!attachment.contentType || !attachment.contentType.startsWith("image/")) {
    return interaction.reply({
      content: "❌ Please upload a valid image file.",
      ephemeral: true
    });
  }

  await interaction.reply("⏳ Processing your screenshot...");

  try {
    // Download image
    const response = await fetch(attachment.url);
    const buffer = Buffer.from(await response.arrayBuffer());

    // OCR (Reads text inside image)
    const result = await Tesseract.recognize(buffer, "eng");
    const text = result.data.text.toLowerCase();

    console.log("Detected text:", text);

    // Check if “Glitch Ninja” is in the screenshot
    if (text.includes("glitch ninja")) {

      const role = interaction.guild.roles.cache.get(ROLE_ID);
      await interaction.member.roles.add(role);

      return interaction.editReply(
        "✅ Verified! Your subscription to Glitch Ninja is confirmed. Role assigned."
      );
    } else {
      return interaction.editReply(
        "❌ You have not subscribed to Glitch Ninja."
      );
    }

  } catch (err) {
    console.error(err);
    return interaction.editReply(
      "❌ Failed to read the screenshot. Please upload a clearer image."
    );
  }
});

// --------- LOGIN ---------
client.login(process.env.TOKEN).then(() => {
  autoRegisterCommands(); // Auto slash command register
});
