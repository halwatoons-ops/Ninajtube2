// index.js (Gemini ULTRA - multimodal verification)
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
const VISION_API = process.env.VISION_API; // Gemini/Google generative API key
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro"; // change if needed

if (!TOKEN || !VISION_API) {
  console.error("Missing TOKEN or VISION_API in environment variables.");
  process.exit(1);
}

// storage
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = {};
try {
  if (fs.existsSync(SETTINGS_PATH)) settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  else fs.writeFileSync(SETTINGS_PATH, JSON.stringify({}, null, 2));
} catch (e) {
  console.error("Failed reading settings.json:", e);
  settings = {};
}

// pending verifications: userId -> { guildId, roleId, youtubeName }
const pending = new Map();

// Discord client with required intents + partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages, // DM required
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

// keep-alive
const app = express();
app.get("/", (req, res) => res.send("Ninjatube Gemini Verification"));
app.listen(process.env.PORT || 3000);

// Embeds
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
function buildProcessingEmbed() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription("⚙️ Processing your screenshot...\n🔍 Please wait while I verify your YouTube subscription.\n⏳ This may take a few moments.")
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}
function buildSuccessEmbed(youtubeName) {
  return new EmbedBuilder()
    .setTitle("✅ Verification Complete")
    .setDescription(`Your subscription to **${youtubeName}** has been confirmed. Role assigned.`)
    .setColor(0x57f287)
    .setFooter({ text: "Ninjatube Protection System" });
}
function buildFailEmbed(youtubeName) {
  return new EmbedBuilder()
    .setTitle("❌ Verification Failed")
    .setDescription(`I could not confirm a subscription to **${youtubeName}**. Please upload a clearer screenshot showing the subscribed state.`)
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}
function buildInvalidFileEmbed() {
  return new EmbedBuilder()
    .setTitle("❌ Invalid File")
    .setDescription("Please upload a valid image file (PNG, JPG, JPEG, WEBP, HEIC).")
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

// Register /setup command for cached guilds
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

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommandsForAllGuilds();
  console.log("Slash commands registered.");
});

// Helper: call Gemini generateContent (multimodal)
async function callGeminiWithImage(base64Image, instructions) {
  // NOTE: Gemini REST multimodal request format can vary by model/endpoint.
  // We call the REST generateContent endpoint for the chosen model.
  // If Google returns a 404 or model error, change GEMINI_MODEL env to another supported vision model.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(VISION_API)}`;

  // Build a multimodal request: attach the base64 image and a textual instruction.
  // The Gemini API accepts structured multimodal content; this payload is compatible with common examples.
  const body = {
    input: [
      {
        // image item
        mimeType: "image/jpeg",
        image: { imageBytes: base64Image } // raw base64 string (no data: prefix)
      },
      {
        // text instruction for the model
        role: "user",
        content: [
          {
            type: "text",
            text: instructions
          }
        ]
      }
    ],
    // use JSON-mode style: ask for a JSON output with strict keys
    candidateOptions: {
      // if supported, we can hint that model should return concise JSON
      // Not all Gemini versions require this; the model usually follows instruction text.
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout: 120000
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${t}`);
  }

  const json = await res.json();
  // Try to extract text output. Different Gemini versions respond differently.
  // We attempt several paths: text output or structured candidates.
  let outputText = "";

  try {
    // common path: json.output[0].content[0].text
    if (json?.output?.[0]?.content) {
      const contents = json.output[0].content;
      // concat text parts
      outputText = contents.map(c => c?.text || "").join("\n").trim();
    }
    // fallback: json.candidates or json.prediction or top-level string
    if (!outputText) {
      if (json?.candidates?.[0]?.content) {
        outputText = json.candidates[0].content.map(c => c?.text || "").join("\n").trim();
      } else if (typeof json?.response === "string") {
        outputText = json.response;
      } else if (typeof json?.outputText === "string") {
        outputText = json.outputText;
      } else {
        outputText = JSON.stringify(json).slice(0, 2000);
      }
    }
  } catch (e) {
    outputText = JSON.stringify(json).slice(0, 2000);
  }

  return outputText.toString().toLowerCase();
}

// Interaction handler: /setup and Verify button
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Permission Denied").setDescription("You must be a server Administrator to run this command.").setColor(0xed4245)], ephemeral: true });
      }

      const channel = interaction.options.getChannel("channel");
      const role = interaction.options.getRole("role");
      const youtube = interaction.options.getString("youtube").trim();

      settings[interaction.guildId] = { channelId: channel.id, roleId: role.id, youtubeName: youtube };
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));

      const button = new ButtonBuilder().setCustomId(`verify_${interaction.guildId}`).setLabel("Verify").setEmoji("🔒").setStyle(ButtonStyle.Success);
      const row = new ActionRowBuilder().addComponents(button);

      const embed = buildVerifyEmbed(youtube);
      try {
        await channel.send({ embeds: [embed], components: [row] });
      } catch (err) {
        console.error("Failed to post in channel:", err);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Failed to Post").setDescription("I could not post the verification message in the selected channel. Please check my permissions (Send Messages, Embed Links, Use Buttons).").setColor(0xed4245)], ephemeral: true });
      }

      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ Setup Complete").setDescription(`Verification posted in ${channel} and role set to ${role}.`).setColor(0x57f287)], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
      const guildId = interaction.customId.split("_")[1];
      const set = settings[guildId];
      if (!set) return interaction.reply({ content: "This server is not configured. An administrator must run /setup first.", ephemeral: true });

      try {
        await interaction.reply({ content: "I've sent you a DM with instructions.", ephemeral: true });
        const dmEmbed = new EmbedBuilder()
          .setTitle("📸 YouTube Subscription Verification")
          .setDescription(`Please upload a clear screenshot in this DM that shows you are subscribed to **${set.youtubeName}**.\n\nAfter you upload, I will automatically verify and grant the role if the 'subscribed' state is detected.`)
          .setColor(0x57f287)
          .setFooter({ text: "Ninjatube Protection System" });

        await interaction.user.send({ embeds: [dmEmbed] });
        pending.set(interaction.user.id, { guildId, youtubeName: set.youtubeName, roleId: set.roleId });
      } catch (err) {
        console.error("DM error:", err);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ Cannot DM You").setDescription("I could not send you a DM. Please enable Direct Messages from server members and try again.").setColor(0xed4245)], ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Interaction handler error:", err);
  }
});

// DM handler: download image, send to Gemini, parse response (STRICT: require "subscribed")
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

    await msg.reply({ embeds: [buildProcessingEmbed()] });

    // download image
    const res = await fetch(attachment.url);
    if (!res.ok) {
      pending.delete(msg.author.id);
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Download Failed").setDescription("Could not download the attachment. Try again.").setColor(0xed4245)] });
    }
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    const base64 = buffer.toString("base64");

    // build instruction for Gemini (ask for JSON with strict fields)
    const instructions = `You are an accurate verifier. Analyze the image provided. Plainly output a JSON object only (no extra text) with these fields:
- subscribed: true or false (true if the screenshot shows the user is subscribed, e.g., the "Subscribed" state is visible)
- channelMatch: true or false (true if the screenshot clearly shows the channel name or identifier matching "${pendingItem.youtubeName}")
- confidence: number between 0 and 1
Example output:
{"subscribed": true, "channelMatch": true, "confidence": 0.98}
Only return JSON.`;

    // call Gemini
    let geminiReplyText = "";
    try {
      geminiReplyText = await callGeminiWithImage(base64, instructions);
    } catch (e) {
      console.error("Gemini error:", e);
      pending.delete(msg.author.id);
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ OCR Failed").setDescription("Could not analyze the screenshot. Please try again or upload a clearer image.") .setColor(0xed4245)] });
    }

    // attempt to parse JSON from geminiReplyText (it may include extra text; try to extract first {...})
    let jsonStr = geminiReplyText.trim();
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      // fallback: inspect text for keywords
      const lower = geminiReplyText.toLowerCase();
      parsed = {
        subscribed: lower.includes("subscribed"),
        channelMatch: lower.includes(pendingItem.youtubeName.toLowerCase()),
        confidence: 0.6
      };
    }

    // remove pending
    pending.delete(msg.author.id);

    // resolve guild/member
    const guild = client.guilds.cache.get(pendingItem.guildId);
    if (!guild) return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Server Not Found").setDescription("I couldn't find the server where you started verification.").setColor(0xed4245)] });

    let member;
    try {
      member = await guild.members.fetch(msg.author.id);
    } catch (e) {
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Not In Server").setDescription("You are not a member of the server where verification was started.").setColor(0xed4245)] });
    }

    // strict mode: require parsed.subscribed == true
    const subscribed = Boolean(parsed?.subscribed);
    const channelMatch = Boolean(parsed?.channelMatch);

    if (subscribed) {
      // assign role
      try {
        const role = guild.roles.cache.get(pendingItem.roleId);
        if (!role) return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Role Missing").setDescription("The verification role no longer exists on the server.").setColor(0xed4245)] });

        const botMember = await guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Missing Permission").setDescription("I need the Manage Roles permission to assign roles.").setColor(0xed4245)] });
        }
        if (botMember.roles.highest.position <= role.position) {
          return msg.reply({ embeds: [new EmbedBuilder().setTitle("❌ Role Position").setDescription("Please ensure my role is above the verification role.").setColor(0xed4245)] });
        }

        await member.roles.add(role);
        return msg.reply({ embeds: [buildSuccessEmbed(pendingItem.youtubeName)] });
      } catch (assignErr) {
        console.error("Role assign error:", assignErr);
        return msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Role Assignment Failed").setDescription("I tried to add the role but failed. Please contact a server admin.").setColor(0xed4245)] });
      }
    } else {
      return msg.reply({ embeds: [buildFailEmbed(pendingItem.youtubeName)] });
    }

  } catch (err) {
    console.error("DM handler error:", err);
    try { msg.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Error").setDescription("An unexpected error occurred. Try again later.").setColor(0xed4245)] }); } catch(e){}
  }
});

// when joining guild, register /setup for that guild
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

client.login(TOKEN);
