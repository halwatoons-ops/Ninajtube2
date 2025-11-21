// index.js
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");
const express = require("express");
require("dotenv").config();

const OCR_KEY = process.env.OCR_KEY;
const TOKEN = process.env.TOKEN;

if (!OCR_KEY || !TOKEN) {
  console.error("Missing TOKEN or OCR_KEY in environment variables!");
  process.exit(1);
}

// -------- settings storage --------
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = fs.existsSync(SETTINGS_PATH)
  ? JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"))
  : {};

// save settings
function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// -------- client --------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// verification queue (per user)
const waiting = new Map();

// uptime server
const app = express();
app.get("/", (req, res) => res.send("Ninjatube Verification System"));
app.listen(process.env.PORT || 3000);

// -------- helper embeds --------
function embedVerify(channelName) {
  return new EmbedBuilder()
    .setTitle("🛡️ Server Verification")
    .setDescription(
      `To access this server, please verify your subscription to **${channelName}**.\n\nClick the button below to begin.`
    )
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function embedAskUpload(channelName) {
  return new EmbedBuilder()
    .setTitle("📸 Upload Your Screenshot")
    .setDescription(
      `Please upload a clear screenshot showing:\n\n✓ **Subscribed**\n✓ **${channelName}**\n\nI will verify it automatically.`
    )
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function embedProcessing() {
  return new EmbedBuilder()
    .setTitle("🔍 Verifying Screenshot")
    .setDescription("Processing your screenshot… Please wait a few moments.")
    .setColor(0xed4245);
}

// -------- READY --------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "Verifying subscribers" }],
    status: "online"
  });

  // auto register when ready
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const slash = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup verification channel & role & YouTube name")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Verification channel").setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("role").setDescription("Role to give after verification").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("youtube").setDescription("Exact YouTube channel name").setRequired(true)
    )
    .toJSON();

  for (const [gid] of client.guilds.cache) {
    await rest.put(Routes.applicationGuildCommands(client.application.id, gid), {
      body: [slash],
    });
    console.log("Registered /setup →", gid);
  }
});

// -------- INTERACTIONS --------
client.on("interactionCreate", async interaction => {
  // SLASH COMMAND
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "❌ Only administrators can run this command.",
        ephemeral: true
      });
    }

    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const youtube = interaction.options.getString("youtube");

    settings[interaction.guildId] = {
      verifyChannel: channel.id,
      roleId: role.id,
      youtubeName: youtube
    };
    saveSettings();

    const button = new ButtonBuilder()
      .setCustomId(`verify_${interaction.guildId}`)
      .setLabel("Verify")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🔒");

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      embeds: [embedVerify(youtube)],
      components: [row]
    });

    return interaction.reply({
      content: `✅ Setup complete.\nVerification posted in ${channel}.`,
      ephemeral: true
    });
  }

  // VERIFY BUTTON
  if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
    const guildId = interaction.customId.split("_")[1];
    const set = settings[guildId];

    if (!set)
      return interaction.reply({ content: "❌ Setup not completed.", ephemeral: true });

    // Ask user to upload screenshot
    const msg = await interaction.channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embedAskUpload(set.youtubeName)]
    });

    waiting.set(interaction.user.id, {
      guildId,
      stepMessage: msg.id,
      youtube: set.youtubeName,
      roleId: set.roleId
    });

    return interaction.reply({ content: "Check the new message below.", ephemeral: true });
  }
});

// -------- MESSAGE HANDLER (screenshot upload) --------
client.on("messageCreate", async msg => {
  if (!msg.guild) return;
  if (msg.author.bot) return;

  const user = waiting.get(msg.author.id);
  if (!user) return;

  const set = settings[user.guildId];
  if (!set) return;

  // must upload in verification channel
  if (msg.channel.id !== set.verifyChannel) return;

  const file = msg.attachments.first();
  if (!file) return;

  // delete user's screenshot message to clean channel
  msg.delete().catch(() => {});

  // send processing embed
  const processMsg = await msg.channel.send({
    content: `<@${msg.author.id}>`,
    embeds: [embedProcessing()]
  });

  // OCR API
  try {
    const form = new FormData();
    form.append("apikey", OCR_KEY);
    form.append("language", "eng");
    form.append("isOverlayRequired", "false");
    form.append("OCREngine", "2");
    form.append("url", file.url);

    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: form
    });

    const data = await res.json();
    const text = (
      data?.ParsedResults?.[0]?.ParsedText || ""
    ).toLowerCase();

    const expected = user.youtube.toLowerCase();

    if (text.includes("subscribed") && text.includes(expected)) {
      // give role
      const guild = client.guilds.cache.get(user.guildId);
      const member = await guild.members.fetch(msg.author.id);
      const role = guild.roles.cache.get(user.roleId);

      await member.roles.add(role);

      waiting.delete(msg.author.id);

      return processMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Verification Successful")
            .setDescription(
              `You are subscribed to **${user.youtube}**.\nRole has been assigned.`
            )
            .setColor(0x57f287)
        ]
      });
    } else {
      waiting.delete(msg.author.id);

      return processMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Verification Failed")
            .setDescription(
              `You are **NOT subscribed** to **${user.youtube}**.\nPlease upload a valid screenshot.`
            )
            .setColor(0xed4245)
        ]
      });
    }
  } catch (e) {
    waiting.delete(msg.author.id);

    return msg.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("⚠️ OCR Error")
          .setDescription("Failed to read screenshot. Try again with a clearer image.")
          .setColor(0xed4245)
      ]
    });
  }
});

// LOGIN
client.login(TOKEN);
