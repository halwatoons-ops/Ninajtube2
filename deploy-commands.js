const { REST, Routes, SlashCommandBuilder } = require("discord.js");
require("dotenv").config();

const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Start the verification process")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("Deploying Slash Commands...");
    await rest.put(
      Routes.applicationGuildCommands("1439605306396119160", "1416693493958447167"),
      { body: commands }
    );
    console.log("Commands Registered!");
  } catch (error) {
    console.error(error);
  }
})();
