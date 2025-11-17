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
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");
const express = require("express");
require("dotenv").config();

const TOKEN = process.env.TOKEN;

// storage
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = {};

try {
  if (fs.existsSync(SETTINGS_PATH))
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  else fs.writeFileSync(SETTINGS_PATH, JSON.stringify({}, null, 2));
} catch (e) {
  settings = {};
}

// pending users
const pending = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// keep alive
const app = express();
app.get("/", (req, res) => res.send("Ninjatube Verification"));
app.listen(process.env.PORT || 3000);

// save settings
function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// ✨ verification embed
function buildVerifyEmbed(youtubeName) {
  return new EmbedBuilder()
    .setTitle("🛡️ Server Verification")
    .setDescription(
      `To access this server, please complete the verification below.\n\n` +
        `📸 Please verify your YouTube subscription to **${youtubeName}**.\n\n` +
        `Click **Verify** to begin.`
    )
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

// ✨ processing embed
function buildProcessingEmbed() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription(
      "⚙️ Processing your screenshot...\n" +
        "🔍 Checking your verification...\n" +
        "⏳ This may take a few moments."
    )
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

// register commands
async function registerCommandsForAllGuilds() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const command = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure verification system")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel for verification message")
        .setRequired(true)
    )
    .addRoleOption((opt) =>
      opt
        .setName("role")
        .setDescription("Role to give after verification")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("youtube")
        .setDescription("YouTube channel name to verify")
        .setRequired(true)
    )
    .toJSON();

  for (const [guildId] of client.guilds.cache) {
    await rest.put(
      Routes.applicationGuildCommands(client.application.id, guildId),
      { body: [command] }
    );
  }
}

client.once("ready", async () => {
  await registerCommandsForAllGuilds();
  console.log("Bot online.");
});

// interaction handler
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    )
      return interaction.reply({
        content: "Only administrators can run this command.",
        ephemeral: true
      });

    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const youtube = interaction.options.getString("youtube");

    settings[interaction.guildId] = {
      channelId: channel.id,
      roleId: role.id,
      youtubeName: youtube
    };
    saveSettings();

    // create verify button
    const button = new ButtonBuilder()
      .setCustomId(`verify_${interaction.guildId}`)
      .setLabel("Verify")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      embeds: [buildVerifyEmbed(youtube)],
      components: [row]
    });

    return interaction.reply({
      content: "Verification system is now active.",
      ephemeral: true
    });
  }

  // verify button
  if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
    const guildId = interaction.customId.split("_")[1];
    const set = settings[guildId];

    await interaction.reply({
      content: "I have sent you a DM.",
      ephemeral: true
    });

    const dmEmbed = new EmbedBuilder()
      .setTitle("📸 Verification Required")
      .setDescription(
        `Please upload a screenshot showing that you subscribed to **${set.youtubeName}**.`
      )
      .setColor(0x57f287);

    await interaction.user.send({ embeds: [dmEmbed] });

    pending.set(interaction.user.id, {
      guildId,
      roleId: set.roleId,
      youtubeName: set.youtubeName
    });
  }
});

// DM handler
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.guild) return;

  const pendingItem = pending.get(msg.author.id);
  if (!pendingItem) return;

  const attachment = msg.attachments.first();
  if (!attachment)
    return msg.reply("Please upload a valid screenshot.");

  await msg.reply({ embeds: [buildProcessingEmbed()] });

  pending.delete(msg.author.id);

  // success
  const guild = client.guilds.cache.get(pendingItem.guildId);
  const member = await guild.members.fetch(msg.author.id);
  const role = guild.roles.cache.get(pendingItem.roleId);

  await member.roles.add(role);

  return msg.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("✅ Verification Complete")
        .setDescription(
          `You have been successfully verified for subscribing to **${pendingItem.youtubeName}**.`
        )
        .setColor(0x57f287)
    ]
  });
});

client.login(TOKEN);
