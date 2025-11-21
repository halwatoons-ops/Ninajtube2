const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonStyle,
  ButtonBuilder,
  EmbedBuilder
} = require("discord.js");
require("dotenv").config();

const TOKEN = process.env.TOKEN;
const HF_TOKEN = process.env.HF_TOKEN;
if (!TOKEN || !HF_TOKEN) {
  console.log("Missing TOKEN or HF_TOKEN");
  process.exit(1);
}

// ---------- storage ----------
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = {};
if (fs.existsSync(SETTINGS_PATH))
  settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
else fs.writeFileSync(SETTINGS_PATH, JSON.stringify({}, null, 2));

// pending = userId -> { guildId, channelId, roleId, youtubeName }
const pending = new Map();

// ---------- client ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// uptime server
const app = express();
app.get("/", (_, res) => res.send("Ninjatube Verification System Running"));
app.listen(process.env.PORT || 3000);

// ---------- OCR ----------
async function runOCR(imageBuffer) {
  const response = await fetch(
    "https://api-inference.huggingface.co/models/Qwen/Qwen2-VL-2B-Instruct",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: {
          prompt: "Extract all visible text from this image.",
          image: imageBuffer.toString("base64")
        }
      })
    }
  );

  const data = await response.json();
  try {
    return data[0].generated_text || "";
  } catch {
    return "";
  }
}

// ---------- UI embeds ----------
function setupEmbed(youtubeName) {
  return new EmbedBuilder()
    .setTitle("🛡️ Verification Required")
    .setDescription(
      `Please upload a screenshot showing you are subscribed to **${youtubeName}**.\n` +
      `Click **Verify** to continue.`
    )
    .setColor(0xed4245)
    .setFooter({ text: "Ninjatube Protection System" });
}

function processingEmbed() {
  return new EmbedBuilder()
    .setTitle("📸 Verifying Screenshot")
    .setDescription(
      "⚙️ Processing your screenshot...\n" +
      "🔍 Checking subscription...\n" +
      "⏳ Please wait a moment..."
    )
    .setColor(0xed4245);
}

// ---------- READY ----------
client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ---------- /setup ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setup") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "Admin only.", ephemeral: true });

    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const youtube = interaction.options.getString("youtube");

    settings[interaction.guildId] = {
      channelId: channel.id,
      roleId: role.id,
      youtubeName: youtube
    };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));

    const verifyBtn = new ButtonBuilder()
      .setCustomId(`verify_${interaction.guildId}`)
      .setLabel("Verify")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(verifyBtn);

    await channel.send({ embeds: [setupEmbed(youtube)], components: [row] });

    return interaction.reply({
      content: `Setup complete! Verification posted in ${channel}.`,
      ephemeral: true
    });
  }
});

// ---------- Verify Button ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("verify_")) {
    const guildId = interaction.customId.split("_")[1];
    const conf = settings[guildId];
    if (!conf) return interaction.reply({ content: "Setup missing.", ephemeral: true });

    pending.set(interaction.user.id, {
      guildId,
      channelId: interaction.channel.id,
      roleId: conf.roleId,
      youtubeName: conf.youtubeName
    });

    return interaction.reply({
      content: "Please upload your screenshot **in this channel**.",
      ephemeral: true
    });
  }
});

// ---------- Screenshot Handler ----------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!pending.has(msg.author.id)) return;

  const attach = msg.attachments.first();
  if (!attach) return;

  const info = pending.get(msg.author.id);
  pending.delete(msg.author.id);

  await msg.reply({ embeds: [processingEmbed()] });

  const res = await fetch(attach.url);
  const buf = Buffer.from(await res.arrayBuffer());

  const text = (await runOCR(buf)).toLowerCase();
  const expected = info.youtubeName.toLowerCase();

  const guild = client.guilds.cache.get(info.guildId);
  const member = await guild.members.fetch(msg.author.id);

  if (text.includes(expected)) {
    await member.roles.add(info.roleId);
    return msg.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Verified Successfully")
          .setDescription(`You are subscribed to **${info.youtubeName}**.\nRole granted!`)
          .setColor(0x57f287)
      ]
    });
  } else {
    return msg.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌ Verification Failed")
          .setDescription(`You are **not subscribed** to **${info.youtubeName}**.`)
          .setColor(0xed4245)
      ]
    });
  }
});

client.login(TOKEN);
