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
const OCR_API = process.env.OCR_API;
if (!TOKEN) {
  console.error("Missing TOKEN in environment variables.");
  process.exit(1);
}
if (!OCR_API) {
  console.error("Missing OCR_API in environment variables.");
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

// ---------- client (intents + partials) ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.Attachment
  ]
});

// ---------- keep-alive server ----------
const app = express();
app.get("/", (req, res) => res.send("Ninjatube OCR Verification Service"));
app.listen(process.env.PORT || 3000, () => console.log("Uptime server online"));

// ---------- helper: save settings ----------
function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// ---------- embed helpers ----------
function buildVerifyEmbed(youtubeName) {
  return new EmbedBuilder()
    .setTitle("🛡️ Server Verification")
    .setDescription(
      `To gain access to the server, please complete the verification process below.\n\n` +
      `📸 Please verify your YouTube subscription to **${youtubeName}**.\n\n` +
      `Click the Verify button to begin.`
    )
    .setColor(0xED4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function buildProcessingEmbed() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription("⚙️ Processing your screenshot...\n🔍 Please wait while I verify your YouTube subscription.\n⏳ This may take a few moments.")
    .setColor(0xED4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function buildSuccessEmbed(youtubeName) {
  return new EmbedBuilder()
    .setTitle("✅ Verification Complete")
    .setDescription(`Your subscription to **${youtubeName}** has been confirmed. You have been given the role.`)
    .setColor(0x57F287)
    .setFooter({ text: "Ninjatube Protection System" });
}

function buildFailEmbed(youtubeName) {
  return new EmbedBuilder()
    .setTitle("❌ Verification Failed")
    .setDescription(`You have not subscribed to **${youtubeName}**.`)
    .setColor(0xED4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function buildInvalidFileEmbed() {
  return new EmbedBuilder()
    .setTitle("❌ Invalid File")
    .setDescription("Please upload a valid image file (PNG, JPG, JPEG, WEBP, HEIC, etc.).")
    .setColor(0xED4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

// ---------- register commands per guild ----------
async function registerCommandsForAllGuilds() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const command = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure verification: channel, role and YouTube channel name")
    .addChannelOption(opt => opt.setName("channel").setDescription("Channel where verification message will be posted").setRequired(true))
    .addRoleOption(opt => opt.setName("role").setDescription("Role to give on successful verification").setRequired(true))
    .addStringOption(opt => opt.setName("youtube").setDescription("Exact YouTube channel name to verify (case-insensitive)").setRequired(true))
    .toJSON();

  try {
    for (const [guildId] of client.guilds.cache) {
      await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: [command] });
      console.log(`Registered /setup for guild ${guildId}`);
    }
  } catch (err) {
    console.error("Failed registering commands:", err);
  }
}

// ---------- ready ----------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommandsForAllGuilds();
    console.log("Slash commands registered for cached guilds.");
  } catch (e) {
    console.error("Command registration error:", e);
  }
});

// ---------- interaction handler ----------
client.on("interactionCreate", async (interaction) => {
  try {
    // /setup
    if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Permission Denied").setDescription("You must be a server Administrator to run this command.").setColor(0xED4245)], ephemeral: true });
      }

      const channel = interaction.options.getChannel("channel");
      const role = interaction.options.getRole("role");
      const youtube = interaction.options.getString("youtube").trim();

      settings[interaction.guildId] = { channelId: channel.id, roleId: role.id, youtubeName: youtube };
      saveSettings();

      const button = new ButtonBuilder()
        .setCustomId(`verify_${interaction.guildId}`)
        .setLabel("Verify")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(button);
      const embed = buildVerifyEmbed(youtube);

      try {
        await channel.send({ embeds: [embed], components: [row] });
      } catch (err) {
        console.error("Failed to post in channel:", err);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Failed to Post").setDescription("I could not post the verification message in the selected channel. Please check my permissions (Send Messages, Embed Links, Use Buttons).").setColor(0xED4245)], ephemeral: true });
      }

      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ Setup Complete").setDescription(`Verification posted in ${channel} and role set to ${role}.`).setColor(0x57F287)], ephemeral: true });
    }

    // Verify button pressed
    if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
      const guildId = interaction.customId.split("_")[1];
      const set = settings[guildId];
      if (!set) return interaction.reply({ content: "This server is not configured. An administrator must run /setup first.", ephemeral: true });

      // DM user
      try {
        await interaction.reply({ content: "I've sent you a DM with instructions.", ephemeral: true });

        const dmEmbed = new EmbedBuilder()
          .setTitle("📸 YouTube Subscription Verification")
          .setDescription(`Please upload a clear screenshot in this DM that shows you are subscribed to **${set.youtubeName}**.\n\nAfter you upload, I will automatically verify and grant the role if the channel name is detected.`)
          .setColor(0x57F287)
          .setFooter({ text: "Ninjatube Protection System" });

        await interaction.user.send({ embeds: [dmEmbed] });

        pending.set(interaction.user.id, { guildId, youtubeName: set.youtubeName, roleId: set.roleId });
      } catch (err) {
        console.error("DM error:", err);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Cannot DM You").setDescription("I could not send you a DM. Please enable Direct Messages from server members and try again.").setColor(0xED4245)], ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Interaction handler error:", err);
  }
});

// ---------- DM message handler (OCR using OCR.Space) ----------
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (msg.guild) return; // only DMs here

    const pendingItem = pending.get(msg.author.id);
    if (!pendingItem) return;

    const attachment = msg.attachments.first();
    if (!attachment) {
      return msg.reply({ embeds: [buildInvalidFileEmbed()] });
    }

    // reply processing embed
    await msg.reply({ embeds: [buildProcessingEmbed()] });

    // fetch image and convert to base64
    const res = await fetch(attachment.url);
    if (!res.ok) {
      pending.delete(msg.author.id);
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Download Failed").setDescription("Could not download the attachment. Try again.") .setColor(0xED4245)] });
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");
    const mime = attachment.contentType || "image/png";
    const base64Image = `data:${mime};base64,${base64}`;

    // call OCR.Space
    const params = new URLSearchParams();
    params.append("apikey", OCR_API);
    params.append("language", "eng");
    params.append("isOverlayRequired", "false");
    params.append("base64Image", base64Image);

    let ocrJson;
    try {
      const ocrRes = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        timeout: 60000
      });
      ocrJson = await ocrRes.json();
    } catch (ocrErr) {
      console.error("OCR API error:", ocrErr);
      pending.delete(msg.author.id);
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ OCR Failed").setDescription("Could not read the screenshot. Please upload a clearer image.") .setColor(0xED4245)] });
    }

    // parse OCR result
    const parsedText = (ocrJson?.ParsedResults?.[0]?.ParsedText || "").toLowerCase();
    const expected = pendingItem.youtubeName.toLowerCase();

    // remove pending
    pending.delete(msg.author.id);

    // find guild & member
    const guild = client.guilds.cache.get(pendingItem.guildId);
    if (!guild) {
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Server Not Found").setDescription("I couldn't find the server where you started verification.") .setColor(0xED4245)] });
    }

    let member;
    try {
      member = await guild.members.fetch(msg.author.id);
    } catch (e) {
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Not In Server").setDescription("You are not a member of the server where verification was started.") .setColor(0xED4245)] });
    }

    // check parsed text for expected channel name
    if (parsedText.includes(expected)) {
      // assign role
      try {
        const role = guild.roles.cache.get(pendingItem.roleId);
        if (!role) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Role Missing").setDescription("The verification role no longer exists on the server.") .setColor(0xED4245)] });
        }

        // check bot permissions and role position
        const botMember = await guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Missing Permission").setDescription("I need the **Manage Roles** permission to assign roles.") .setColor(0xED4245)] });
        }
        if (botMember.roles.highest.position <= role.position) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Role Position").setDescription("Please make sure my role is above the role to assign in the server settings.") .setColor(0xED4245)] });
        }

        await member.roles.add(role);
        return msg.reply({ embeds: [buildSuccessEmbed(pendingItem.youtubeName)] });
      } catch (assignErr) {
        console.error("Role assign error:", assignErr);
        return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Role Assignment Failed").setDescription("I tried to add the role but failed. Please contact a server admin.") .setColor(0xED4245)] });
      }
    } else {
      // failed verification
      return msg.reply({ embeds: [buildFailEmbed(pendingItem.youtubeName)] });
    }

  } catch (err) {
    console.error("DM handler error:", err);
    try { msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Error").setDescription("An unexpected error occurred. Try again later.") .setColor(0xED4245)] }); } catch(e){}
  }
});

// ---------- when bot joins a new guild, register command there ----------
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
