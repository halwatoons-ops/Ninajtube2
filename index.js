// ===============================
// NINJATUBE VERIFICATION SYSTEM
// Gemini OCR + Image Setup Version
// ===============================

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
  AttachmentBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require("discord.js");
const express = require("express");
require("dotenv").config();

const TOKEN = process.env.TOKEN;
const GEMINI_KEY = process.env.VISION_API;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro";

if (!TOKEN || !GEMINI_KEY) {
  console.error("Missing TOKEN or VISION_API.");
  process.exit(1);
}

// ===============================
// STORAGE
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

// pending map
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

// ===============================
// KEEP ALIVE (RENDER)
// ===============================
const app = express();
app.get("/", (req, res) =>
  res.send("Ninjatube Verification System Active")
);
app.listen(process.env.PORT || 3000);

// ===============================
// GEMINI OCR FUNCTION
// ===============================
async function geminiExtractText(base64Img) {
  const url =
    `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Extract ONLY the YouTube channel name from this screenshot. Do NOT give extra text."
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
    throw new Error("Gemini OCR failed.");
  }

  const json = await res.json();

  return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ===============================
// EMBEDS
// ===============================
function embedSetup(channelName) {
  return new EmbedBuilder()
    .setTitle("🛡️ Server Verification")
    .setDescription(
      `Please verify your subscription to **${channelName}**.\n\nClick **Verify** to continue in DM.`
    )
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function embedProcessing() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription(
      "⚙️ Processing your screenshot...\n🔍 Checking your subscription...\n⏳ Please wait..."
    )
    .setColor(0xed4245);
}

// ===============================
// REGISTER COMMANDS
// ===============================
async function registerCmd(guildId) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const command = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup server verification system")
    .addChannelOption(o =>
      o
        .setName("channel")
        .setDescription("Channel to post verification embed")
        .setRequired(true)
    )
    .addRoleOption(o =>
      o
        .setName("role")
        .setDescription("Role to give after verification")
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
    await registerCmd(gid);
  }
});

// ===============================
// GUILD JOIN
// ===============================
client.on("guildCreate", guild => registerCmd(guild.id));

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
    const base64 = Buffer.from(arr).toString("base64");

    // Extract channel name from screenshot
    let channelName;
    try {
      channelName = await geminiExtractText(base64);
    } catch {
      return interaction.reply({
        content: "❌ Failed to read screenshot. Try a clearer image.",
        ephemeral: true
      });
    }

    if (!channelName || channelName.length < 2) {
      return interaction.reply({
        content: "❌ Unable to detect channel name from screenshot.",
        ephemeral: true
      });
    }

    // Save
    settings[interaction.guildId] = {
      channelId: channel.id,
      roleId: role.id,
      youtubeName: channelName.trim()
    };
    saveSettings();

    const button = new ButtonBuilder()
      .setCustomId(`verify_${interaction.guildId}`)
      .setLabel("Verify")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      embeds: [embedSetup(channelName)],
      components: [row]
    });

    interaction.reply({
      content: `✅ Setup complete.\nDetected YouTube channel: **${channelName}**`,
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
        content: "❌ Server not configured yet.",
        ephemeral: true
      });
    }

    await interaction.reply({
      content: "📩 I have sent you a DM.",
      ephemeral: true
    });

    const embed = new EmbedBuilder()
      .setTitle("📸 YouTube Verification")
      .setDescription(
        `Please upload a screenshot that shows you are subscribed to **${cfg.youtubeName}**.`
      )
      .setColor(0x57f287);

    await interaction.user.send({ embeds: [embed] });

    pending.set(interaction.user.id, {
      guildId: gid,
      youtubeName: cfg.youtubeName,
      roleId: cfg.roleId
    });
  }
});

// ===============================
// DM HANDLER
// ===============================
client.on("messageCreate", async msg => {
  if (msg.guild) return;
  if (msg.author.bot) return;

  const pend = pending.get(msg.author.id);
  if (!pend) return;

  const img = msg.attachments.first();
  if (!img) return msg.reply("⚠️ Please upload a screenshot image.");

  await msg.reply({ embeds: [embedProcessing()] });

  const res = await fetch(img.url);
  const arr = await res.arrayBuffer();
  const base64 = Buffer.from(arr).toString("base64");

  let matched = false;
  try {
    const extracted = await geminiExtractText(base64);
    matched = extracted.toLowerCase().includes(pend.youtubeName.toLowerCase());
  } catch {
    return msg.reply(
      "⚠️ OCR Failed. Please upload a clearer screenshot."
    );
  }

  pending.delete(msg.author.id);

  const guild = client.guilds.cache.get(pend.guildId);
  const member = await guild.members.fetch(msg.author.id);

  if (matched) {
    await member.roles.add(pend.roleId);
    return msg.reply(
      `✅ Verified! You are subscribed to **${pend.youtubeName}**.`
    );
  } else {
    return msg.reply(
      `❌ Verification failed. You are not subscribed to **${pend.youtubeName}**.`
    );
  }
});

// ===============================
client.login(TOKEN);
