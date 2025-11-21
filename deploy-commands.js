// deploy-commands.js
const { REST, Routes, SlashCommandBuilder } = require("discord.js");
require("dotenv").config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const slash = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup verification system")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Verification channel").setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("role").setDescription("Role to give after verification").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("youtube").setDescription("YouTube channel name").setRequired(true)
    )
].map(c => c.toJSON());

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Deploying commands…");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slash });
    console.log("Commands deployed!");
  } catch (e) {
    console.error(e);
  }
})();
