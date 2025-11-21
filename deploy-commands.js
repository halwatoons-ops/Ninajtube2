const { REST, Routes, SlashCommandBuilder } = require("discord.js");
require("dotenv").config();

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup the verification system")
    .addChannelOption(o => o.setName("channel").setDescription("Where verify button will appear").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role to give after verification").setRequired(true))
    .addAttachmentOption(o => o.setName("screenshot").setDescription("Upload YouTube subscription screenshot").setRequired(true))
    .toJSON()
];

(async () => {
  try {
    console.log("Deploying...");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("Commands Registered!");
  } catch (err) {
    console.error(err);
  }
})();
