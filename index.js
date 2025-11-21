const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const express = require("express"); // ADDED
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
require("dotenv").config();

// ------------------------------------
// EXPRESS SERVER FOR RENDER
// ------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("NinjaTube Bot Running ✔"));
app.listen(PORT, () => console.log("🌐 Webserver running on PORT " + PORT));
// ------------------------------------

const TOKEN = process.env.TOKEN;
const HF_TOKEN = process.env.HF_TOKEN;

if (!TOKEN || !HF_TOKEN) {
  console.error("❌ Missing TOKEN or HF_TOKEN in Render Environment");
  process.exit(1);
}

// LOAD SETTINGS
const SETTINGS_PATH = path.join(__dirname, "settings.json");
let settings = {};
try {
  if (fs.existsSync(SETTINGS_PATH))
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
} catch {
  settings = {};
}

// SAVE SETTINGS
function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// OCR FUNCTION USING QWEN2-VL
async function readTextFromImage(buffer) {
  const res = await fetch(
    "https://api-inference.huggingface.co/models/Qwen/Qwen2-VL-2B-Instruct",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`
      },
      body: buffer
    }
  );

  let json = await res.json();

  try {
    return json[0].generated_text.toLowerCase();
  } catch {
    return "";
  }
}

// DM_VERIFICATION
const pending = new Map();

// READY
client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "Verifying Subscribers" }],
    status: "online"
  });
});

// INTERACTION HANDLER
client.on("interactionCreate", async interaction => {
  // /setup COMMAND
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    const member = interaction.member;
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "❌ You must be Administrator.",
        ephemeral: true
      });
    }

    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const screenshot = interaction.options.getAttachment("screenshot");

    if (!screenshot.contentType.startsWith("image/")) {
      return interaction.reply({
        content: "❌ Screenshot must be an image.",
        ephemeral: true
      });
    }

    // Download owner screenshot
    const r = await fetch(screenshot.url);
    const buf = Buffer.from(await r.arrayBuffer());

    // Extract text
    const extracted = await readTextFromImage(buf);

    if (!extracted || extracted.length < 3) {
      return interaction.reply({
        content: "❌ Could not read text from screenshot. Use a clearer image.",
        ephemeral: true
      });
    }

    // Save
    settings[interaction.guildId] = {
      channelId: channel.id,
      roleId: role.id,
      verifyText: extracted
    };
    saveSettings();

    const btn = new ButtonBuilder()
      .setCustomId(`verify_${interaction.guildId}`)
      .setLabel("Verify")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(btn);

    const embed = new EmbedBuilder()
      .setTitle("🛡️ Verification Required")
      .setDescription(
        "Tap **Verify** and complete verification in DM.\n\n" +
          "Make sure your subscription screenshot is clear."
      )
      .setColor(0xed4245);

    await channel.send({ embeds: [embed], components: [row] });

    return interaction.reply({
      content: "✅ Setup complete!",
      ephemeral: true
    });
  }

  // VERIFY BUTTON
  if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
    const gid = interaction.customId.split("_")[1];
    const s = settings[gid];

    if (!s)
      return interaction.reply({
        content: "❌ Server is not configured.",
        ephemeral: true
      });

    try {
      await interaction.reply({
        content: "📨 Check your DM to continue.",
        ephemeral: true
      });

      const dmEmbed = new EmbedBuilder()
        .setTitle("📸 Upload Screenshot")
        .setDescription(
          "Please upload your **subscription screenshot** in this DM.\n\n" +
            "I will verify automatically."
        )
        .setColor(0x57f287);

      await interaction.user.send({ embeds: [dmEmbed] });

      pending.set(interaction.user.id, {
        guildId: gid,
        verifyText: s.verifyText,
        roleId: s.roleId
      });
    } catch {
      interaction.reply({
        content: "❌ Please enable DMs to verify.",
        ephemeral: true
      });
    }
  }
});

// DM HANDLER
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.guild) return;

  const p = pending.get(msg.author.id);
  if (!p) return;

  const attach = msg.attachments.first();
  if (!attach)
    return msg.reply("⚠️ Please upload a screenshot.");

  if (!attach.contentType.startsWith("image/"))
    return msg.reply("❌ File must be an image.");

  msg.reply("🔍 **Reading screenshot… Please wait…**");

  const r = await fetch(attach.url);
  const buf = Buffer.from(await r.arrayBuffer());

  const text = await readTextFromImage(buf);

  if (!text) {
    pending.delete(msg.author.id);
    return msg.reply("❌ Failed to read text. Try a clearer image.");
  }

  const guild = client.guilds.cache.get(p.guildId);
  const member = await guild.members.fetch(msg.author.id);

  if (text.includes(p.verifyText.trim().toLowerCase())) {
    const role = guild.roles.cache.get(p.roleId);
    await member.roles.add(role);

    pending.delete(msg.author.id);

    return msg.reply("✅ **Verified!** Role added.");
  } else {
    pending.delete(msg.author.id);
    return msg.reply("❌ You have NOT subscribed.");
  }
});

// LOGIN
client.login(TOKEN);
