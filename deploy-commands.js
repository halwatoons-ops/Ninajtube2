require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure verification: channel, role and YouTube channel name")
    .addChannelOption(opt =>
      opt.setName("channel")
      .setDescription("Verification channel")
      .setRequired(true)
    )
    .addRoleOption(opt =>
      opt.setName("role")
      .setDescription("Role to assign on successful verification")
      .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("youtube")
      .setDescription("YouTube channel name to verify")
      .setRequired(true)
    )
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Deploying commands...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Commands deployed.");
  } catch (err) {
    console.error(err);
  }
})();
