// index.js
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ButtonStyle, ActionRowBuilder, ButtonBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const express = require("express");
const Tesseract = require("@tesseract.js/node");
require("dotenv").config();

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Missing TOKEN in environment variables.");
  process.exit(1);
}

// ---------- storage ----------
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = {};
try {
  if (fs.existsSync(SETTINGS_PATH)) settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  else fs.writeFileSync(SETTINGS_PATH, JSON.stringify({}, null, 2));
} catch (e) {
  console.error("Failed reading settings.json:", e);
  settings = {};
}

// in-memory pending verification map: userId -> { guildId, youtubeName, roleId }
const pending = new Map();

// ---------- client ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

// ---------- keep-alive server ----------
const app = express();
app.get("/", (req, res) => res.send("Not Ninjatube — Verification Service"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uptime server online (port ${PORT})`));

// ---------- helper: save settings ----------
function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// ---------- helper: build professional embed ----------
function buildVerifyEmbed(youtubeName) {
  const embed = new EmbedBuilder()
    .setTitle("🛡️ Server Verification")
    .setDescription(
      `To gain access to the server, please complete the verification process below.\n\n` +
      `📸 Please verify your YouTube subscription to **${youtubeName}**.\n\n` +
      `Click the button below to begin.`
    )
    .setColor(0xED4245) // red
    .setFooter({ text: "Ninjatube Protection System" });

  return embed;
}

function buildProcessingEmbed() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription("⚙️ Processing your screenshot...\n🔍 Please wait while I verify your YouTube subscription.\n⏳ This may take a few moments.")
    .setColor(0xED4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

// ---------- auto-register slash command for all guilds in cache ----------
async function registerCommandsForAllGuilds() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const command = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure verification: channel, role and YouTube channel name")
    .addChannelOption(opt => opt.setName("channel").setDescription("Channel where verification embed should be posted").setRequired(true))
    .addRoleOption(opt => opt.setName("role").setDescription("Role to give on successful verification").setRequired(true))
    .addStringOption(opt => opt.setName("youtube").setDescription("Exact YouTube channel name to verify (case-insensitive)").setRequired(true))
    .toJSON();

  try {
    // register per guild so commands are instant
    for (const [guildId] of client.guilds.cache) {
      await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: [command] });
      console.log(`Registered /setup for guild ${guildId}`);
    }
  } catch (err) {
    console.error("Failed registering commands:", err);
  }
}

// ---------- on ready ----------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  // set presence
  try {
    await client.user.setPresence({ activities: [{ name: "Verifying subscribers" }], status: "online" });
  } catch (e) {}

  // register commands per guild (instant)
  await registerCommandsForAllGuilds();
  console.log("Slash commands registered for all cached guilds.");
});

// ---------- handle interactionCreate (slash + button) ----------
client.on("interactionCreate", async (interaction) => {
  try {
    // --- Slash: /setup ---
    if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
      // permission check: administrator
      const member = interaction.member;
      if (!member || !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Permission Denied").setDescription("You must be a server Administrator to run this command.").setColor(0xED4245)], ephemeral: true });
      }

      const channel = interaction.options.getChannel("channel");
      const role = interaction.options.getRole("role");
      const youtube = interaction.options.getString("youtube").trim();

      if (!channel || !role || !youtube) {
        return interaction.reply({ content: "Invalid options.", ephemeral: true });
      }

      // save settings for this guild
      settings[interaction.guildId] = { channelId: channel.id, roleId: role.id, youtubeName: youtube };
      saveSettings();

      // create verify button (green)
      const button = new ButtonBuilder()
        .setCustomId(`verify_${interaction.guildId}`)
        .setLabel("Verify")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(button);

      // send professional embed automatically to the selected channel
      const embed = buildVerifyEmbed(youtube);

      try {
        await channel.send({ embeds: [embed], components: [row] });
      } catch (err) {
        console.error("Failed to post in channel:", err);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Failed to Post").setDescription("I could not post the verification message in the selected channel. Please check my permissions (Send Messages, Embed Links, Use Buttons).").setColor(0xED4245)], ephemeral: true });
      }

      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ Setup Complete").setDescription(`Verification posted in ${channel} and role set to ${role}.`).setColor(0x57F287)], ephemeral: true });
    }

    // --- Button press: Verify ---
    if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
      const guildId = interaction.customId.split("_")[1];
      const set = settings[guildId];
      if (!set) {
        return interaction.reply({ content: "This server is not configured. An administrator must run /setup first.", ephemeral: true });
      }

      // attempt to DM the user
      try {
        await interaction.reply({ content: "I've sent you a DM with instructions.", ephemeral: true });
        const dmEmbed = new EmbedBuilder()
          .setTitle("📸 YouTube Subscription Verification")
          .setDescription(`Please upload a clear screenshot in this DM that shows you are subscribed to **${set.youtubeName}**.\n\nAfter you upload, I will automatically verify and grant the role if the channel name is detected.`)
          .setColor(0x57F287)
          .setFooter({ text: "Ninjatube Protection System" });

        const dm = await interaction.user.send({ embeds: [dmEmbed] });

        // mark user as pending verification for this guild
        pending.set(interaction.user.id, { guildId, youtubeName: set.youtubeName, roleId: set.roleId });

      } catch (err) {
        // cannot DM
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Cannot DM You").setDescription("I could not send you a DM. Please enable Direct Messages from server members and try again.").setColor(0xED4245)], ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Interaction handler error:", err);
  }
});

// ---------- listen for DMs (user uploads screenshot in DM) ----------
client.on("messageCreate", async (msg) => {
  try {
    // only handle DMs (no guild)
    if (msg.author.bot) return;
    if (msg.guild) return; // only process private messages here

    const pendingItem = pending.get(msg.author.id);
    if (!pendingItem) return; // nothing pending for this user

    // check attachments
    const attachment = msg.attachments.first();
    if (!attachment) {
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ No Attachment").setDescription("Please upload a screenshot image as an attachment in this DM.") .setColor(0xED4245)] });
    }

    // validate image MIME
    if (!attachment.contentType || !attachment.contentType.startsWith("image/")) {
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Invalid File").setDescription("Please upload a valid image file (PNG, JPG, WEBP, HEIC, etc.).").setColor(0xED4245)] });
    }

    await msg.reply({ embeds: [buildProcessingEmbed()] });

    // fetch buffer using global fetch (Node 18+)
    const res = await fetch(attachment.url);
    if (!res.ok) {
      pending.delete(msg.author.id);
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Download Failed").setDescription("Could not download the attachment. Try again.") .setColor(0xED4245)] });
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // OCR
    let result;
    try {
      result = await Tesseract.recognize(buffer, "eng");
    } catch (ocrErr) {
      console.error("OCR error:", ocrErr);
      pending.delete(msg.author.id);
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ OCR Failed").setDescription("Could not read the screenshot. Please upload a clearer image.") .setColor(0xED4245)] });
    }

    const text = (result?.data?.text || "").toLowerCase();
    const expected = pendingItem.youtubeName.toLowerCase();

    // remove pending
    pending.delete(msg.author.id);

    // locate guild and member
    const guild = client.guilds.cache.get(pendingItem.guildId);
    if (!guild) {
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Server Not Found").setDescription("I couldn't find the server where you started verification.") .setColor(0xED4245)] });
    }

    let member;
    try {
      member = await guild.members.fetch(msg.author.id);
    } catch (e) {
      // member not in guild
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Not In Server").setDescription("You are not a member of the server where verification was started.") .setColor(0xED4245)] });
    }

    // check text
    if (text.includes(expected)) {
      // assign role
      try {
        const role = guild.roles.cache.get(pendingItem.roleId);
        if (!role) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Role Missing").setDescription("The verification role no longer exists on the server.") .setColor(0xED4245)] });
        }

        // ensure bot can manage roles and role position
        const botMember = await guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Missing Permission").setDescription("I need the **Manage Roles** permission to assign roles.") .setColor(0xED4245)] });
        }
        if (botMember.roles.highest.position <= role.position) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Role Position").setDescription("Please make sure my role is above the role to assign in the server settings.") .setColor(0xED4245)] });
        }

        await member.roles.add(role);
        return msg.reply({ embeds: [new EmbedBuilder().setTitle("✅ Verification Complete").setDescription(`Your subscription to **${pendingItem.youtubeName}** has been confirmed. You have been given the role.`).setColor(0x57F287).setFooter({ text: "Ninjatube Protection System" })] });
      } catch (assignErr) {
        console.error("Role assign error:", assignErr);
        return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Role Assignment Failed").setDescription("I tried to add the role but failed. Please contact a server admin.") .setColor(0xED4245)] });
      }
    } else {
      // failed verification
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Verification Failed").setDescription(`You have not subscribed to **${pendingItem.youtubeName}**.`).setColor(0xED4245).setFooter({ text: "Ninjatube Protection System" })] });
    }

  } catch (err) {
    console.error("DM handler error:", err);
    try { msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Error").setDescription("An unexpected error occurred. Try again later.") .setColor(0xED4245)] }); } catch(e){}
  }
});

// ---------- when bot joins a guild, register the /setup command for that guild ----------
client.on("guildCreate", async (guild) => {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const command = new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Configure verification: channel, role and YouTube channel name")
      .addChannelOption(opt => opt.setName("channel").setDescription("Channel where verification embed should be posted").setRequired(true))
      .addRoleOption(opt => opt.setName("role").setDescription("Role to give on successful verification").setRequired(true))
      .addStringOption(opt => opt.setName("youtube").setDescription("Exact YouTube channel name to verify").setRequired(true))
      .toJSON();

    await rest.put(Routes.applicationGuildCommands(client.application.id, guild.id), { body: [command] });
    console.log(`Registered /setup in new guild ${guild.id}`);
  } catch (e) {
    console.error("Failed to register command for new guild:", e);
  }
});

// ---------- login ----------
client.login(TOKEN);
