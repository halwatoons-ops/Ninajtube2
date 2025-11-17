// =============================================
// NINJATUBE VERIFICATION BOT (GEMINI VERSION)
// Auto detect channel name from image
// Accepts keyword: "GLITCH" OR "NINJA"
// =============================================

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require("discord.js");
const express = require("express");
require("dotenv").config();

// ENV VARS
const TOKEN = process.env.TOKEN;
const GEMINI_KEY = process.env.VISION_API;

if (!TOKEN || !GEMINI_KEY) {
  console.error("Missing TOKEN or VISION_API environment variable.");
  process.exit(1);
}

// ===============================
// SETTINGS STORAGE
// ===============================
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = {};

try {
  if (fs.existsSync(SETTINGS_PATH)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } else {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({}, null, 2));
  }
} catch {
  settings = {};
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// userId → pending: guildId, roleId, keywords[]
const pending = new Map();

// ===============================
// CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Keep Alive Server for Render
const app = express();
app.get("/", (req, res) => res.send("Ninjatube Verification System Running"));
app.listen(process.env.PORT || 3000);

// =================================
// GEMINI VISION OCR FUNCTION (BEST)
// =================================
async function geminiExtractText(buffer, mimeType) {
  const base64 = buffer.toString("base64");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
You are an OCR engine. 
Extract ALL visible text from the image.

RULES:
- Return ONLY raw text found in the screenshot.
- Do NOT describe the image.
- Do NOT summarize.
- Do NOT add extra words.
- Output must be pure text lines.
`
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64
            }
          }
        ]
      }
    ]
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    throw new Error("Gemini Vision API Error");
  }

  const json = await res.json();
  return (
    json?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("\n")
      .trim() || ""
  );
}

// ===============================
// EMBEDS
// ===============================
function setupEmbed(name) {
  return new EmbedBuilder()
    .setTitle("🛡️ Server Verification Setup")
    .setDescription(
      `Verification system is now active.\nUsers must verify with channel: **${name}**.\n\nClick **Verify** in the server to begin.`
    )
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function processingEmbed() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription(
      "⚙️ Processing your screenshot...\n🔍 Reading text...\n⏳ Please wait..."
    )
    .setColor(0xed4245);
}

// ===============================
// REGISTER COMMAND
// ===============================
async function registerCommand(guildId) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const command = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure verification system")
    .addChannelOption(o =>
      o
        .setName("channel")
        .setDescription("Verification channel")
        .setRequired(true)
    )
    .addRoleOption(o =>
      o
        .setName("role")
        .setDescription("Role to give on success")
        .setRequired(true)
    )
    .addAttachmentOption(o =>
      o
        .setName("image")
        .setDescription("Upload your YouTube channel screenshot")
        .setRequired(true)
    )
    .toJSON();

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, guildId),
    { body: [command] }
  );
}

// ===============================
// READY
// ===============================
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const [gid] of client.guilds.cache) {
    await registerCommand(gid);
  }
});

// ===============================
// GUILD JOIN
// ===============================
client.on("guildCreate", guild => registerCommand(guild.id));

// ===============================
// INTERACTION HANDLER
// ===============================
client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return interaction.reply({
        content: "❌ You must be an Administrator.",
        ephemeral: true
      });
    }

    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const image = interaction.options.getAttachment("image");

    // Read image
    const res = await fetch(image.url);
    const arr = await res.arrayBuffer();
    const buffer = Buffer.from(arr);
    const mime = image.contentType;

    let extractedText = "";
    try {
      extractedText = await geminiExtractText(buffer, mime);
    } catch {
      return interaction.reply({
        content: "❌ Failed to read screenshot. Upload a clearer image.",
        ephemeral: true
      });
    }

    // Keywords — GLITCH or NINJA
    const keywords = ["glitch", "ninja"];

    const foundKeyword = keywords.find(k =>
      extractedText.toLowerCase().includes(k)
    );

    if (!foundKeyword) {
      return interaction.reply({
        content:
          "❌ You Havenot Subscribe to Glitch Ninja.",
        ephemeral: true
      });
    }

    // Save settings
    settings[interaction.guildId] = {
      channelId: channel.id,
      roleId: role.id,
      keywords
    };
    saveSettings();

    // Send verify button
    const button = new ButtonBuilder()
      .setCustomId(`verify_${interaction.guildId}`)
      .setLabel("Verify")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      embeds: [setupEmbed("GLITCH / NINJA")],
      components: [row]
    });

    return interaction.reply({
      content: "✅ Setup complete. Verification is now active.",
      ephemeral: true
    });
  }

  // Verify button
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith("verify_")) return;

    const gid = interaction.customId.split("_")[1];
    const cfg = settings[gid];

    if (!cfg) {
      return interaction.reply({
        content: "❌ Server is not configured.",
        ephemeral: true
      });
    }

    await interaction.reply({
      content: "📩 I have sent you a DM to continue verification.",
      ephemeral: true
    });

    const embed = new EmbedBuilder()
      .setTitle("📸 YouTube Verification")
      .setDescription(
        "Please upload a screenshot that clearly shows you are subscribed.\n\n**It must contain 'GLITCH' or 'NINJA'.**"
      )
      .setColor(0x57f287);

    await interaction.user.send({ embeds: [embed] });

    pending.set(interaction.user.id, {
      guildId: gid,
      roleId: cfg.roleId,
      keywords: cfg.keywords
    });
  }
});

// ===============================
// DM SCREENSHOT HANDLER
// ===============================
client.on("messageCreate", async msg => {
  if (msg.guild) return;
  if (msg.author.bot) return;

  const pend = pending.get(msg.author.id);
  if (!pend) return;

  const attachment = msg.attachments.first();
  if (!attachment) {
    return msg.reply("⚠️ Please upload a screenshot image.");
  }

  const res = await fetch(attachment.url);
  const arr = await res.arrayBuffer();
  const buffer = Buffer.from(arr);

  await msg.reply({ embeds: [processingEmbed()] });

  let text = "";
  try {
    text = await geminiExtractText(buffer, attachment.contentType);
  } catch {
    return msg.reply(
      "⚠️ Failed to read screenshot. Please upload a clearer image."
    );
  }

  // Check keyword GLITCH or NINJA
  const matched = pend.keywords.some(k =>
    text.toLowerCase().includes(k)
  );

  pending.delete(msg.author.id);

  const guild = client.guilds.cache.get(pend.guildId);
  const member = await guild.members.fetch(msg.author.id);

  if (matched) {
    await member.roles.add(pend.roleId);
    return msg.reply(
      "✅ Verification successful! You are now verified."
    );
  }

  return msg.reply(
    "❌ Verification failed. Screenshot does not contain required text."
  );
});

// ===============================
client.login(TOKEN);
