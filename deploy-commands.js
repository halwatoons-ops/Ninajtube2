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
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID, 
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Commands Registered Successfully!");
  } catch (error) {
    console.error("Error Deploying Commands:", error);
  }
})();
