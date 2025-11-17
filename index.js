// =============================
// NINJATUBE PROTECTION SYSTEM
// FULLY FIXED GEMINI VERSION
// =============================

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

// ENV
const TOKEN = process.env.TOKEN;
const GEMINI_KEY = process.env.VISION_API;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro";

if (!TOKEN || !GEMINI_KEY) {
  console.error("Missing TOKEN or VISION_API in environment.");
  process.exit(1);
}

// =============================
// SETTINGS STORAGE
// =============================
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = {};

try {
  if (fs.existsSync(SETTINGS_PATH)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } else {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({}, null, 2));
  }
} catch (err) {
  console.error("Failed to read settings.json", err);
  settings = {};
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Store: userId → { guildId, youtubeName, roleId }
const pending = new Map();

// =============================
// CLIENT
// =============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// =============================
// KEEP ALIVE FOR RENDER
// =============================
const app = express();
app.get("/", (req, res) => res.send("Ninjatube Verification System Online"));
app.listen(process.env.PORT || 3000);

// =============================
// EMBEDS
// =============================
function embedSetup(youtubeName) {
  return new EmbedBuilder()
    .setTitle("🛡️ Server Verification")
    .setDescription(
      `Please verify your subscription to **${youtubeName}**.\n\nClick **Verify** below to continue in DM.`
    )
    .setColor(0xED4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function embedProcessing() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription(
      "⚙️ Processing your screenshot...\n" +
      "🔍 Checking your YouTube subscription...\n" +
      "⏳ This may take a few moments."
    )
    .setColor(0xED4245);
}

// =============================
// GEMINI OCR FUNCTION (FIXED)
// =============================
async function analyzeImageWithGemini(base64Img, expectedName) {
  const url =
    `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Extract all visible text from the screenshot. ONLY return plain text.`
          },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: base64Img
            }
          }
        ]
      }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let txt = await res.text();
    throw new Error("Gemini Error: " + txt);
  }

  const json = await res.json();

  const text =
    json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") ||
    "";

  return text.toLowerCase().includes(expectedName.toLowerCase());
}

// =============================
// REGISTER COMMANDS
// =============================
async function registerCmds(guildId) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const cmd = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup verification system")
    .addChannelOption(o =>
      o
        .setName("channel")
        .setDescription("Where verification embed will be posted")
        .setRequired(true)
    )
    .addRoleOption(o =>
      o
        .setName("role")
        .setDescription("Role to give after verification")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("youtube")
        .setDescription("YouTube channel name to verify")
        .setRequired(true)
    )
    .toJSON();

  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
    body: [cmd]
  });
}

// =============================
// READY
// =============================
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  for (const [gid] of client.guilds.cache) {
    await registerCmds(gid);
  }
});

// =============================
// GUILD JOIN
// =============================
client.on("guildCreate", async guild => {
  await registerCmds(guild.id);
});

// =============================
// INTERACTIONS
// =============================
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
    const youtubeName = interaction.options.getString("youtube");

    settings[interaction.guildId] = {
      channelId: channel.id,
      roleId: role.id,
      youtubeName
    };
    saveSettings();

    const button = new ButtonBuilder()
      .setCustomId(`verify_${interaction.guildId}`)
      .setLabel("Verify")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      embeds: [embedSetup(youtubeName)],
      components: [row]
    });

    return interaction.reply({
      content: "✅ Setup completed.",
      ephemeral: true
    });
  }

  // VERIFY BUTTON
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
      content: "📩 I have sent you a DM.",
      ephemeral: true
    });

    const dmMsg = new EmbedBuilder()
      .setTitle("📸 YouTube Verification")
      .setDescription(
        `Please upload a **clear screenshot** showing you are subscribed to **${cfg.youtubeName}**.`
      )
      .setColor(0x57F287);

    await interaction.user.send({ embeds: [dmMsg] });

    pending.set(interaction.user.id, {
      guildId: gid,
      youtubeName: cfg.youtubeName,
      roleId: cfg.roleId
    });
  }
});

// =============================
// DM: USER SENDS SCREENSHOT
// =============================
client.on("messageCreate", async msg => {
  if (msg.guild) return; // only DM
  if (msg.author.bot) return;

  const pend = pending.get(msg.author.id);
  if (!pend) return;

  const file = msg.attachments.first();
  if (!file) {
    return msg.reply("⚠️ Please upload an image screenshot.");
  }

  await msg.reply({ embeds: [embedProcessing()] });

  const res = await fetch(file.url);
  const arr = await res.arrayBuffer();
  const base64 = Buffer.from(arr).toString("base64");

  let ok = false;
  try {
    ok = await analyzeImageWithGemini(base64, pend.youtubeName);
  } catch (err) {
    return msg.reply(
      "⚠️ OCR Failed.\nPlease upload a clearer screenshot."
    );
  }

  pending.delete(msg.author.id);

  const guild = client.guilds.cache.get(pend.guildId);
  const member = await guild.members.fetch(msg.author.id);

  if (ok) {
    await member.roles.add(pend.roleId);
    return msg.reply(
      `✅ Verification successful! You are subscribed to **${pend.youtubeName}**.`
    );
  }

  return msg.reply(
    `❌ You have not subscribed to **${pend.youtubeName}**.`
  );
});

// =============================
// LOGIN
// =============================
client.login(TOKEN);
