require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure verification system")
    .addChannelOption(o => o.setName("channel").setDescription("Verification channel").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role to give after verification").setRequired(true))
    .addStringOption(o => o.setName("youtube").setDescription("Exact YouTube channel name").setRequired(true))
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Deploying slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Commands deployed!");
  } catch (e) {
    console.log(e);
  }
})();
