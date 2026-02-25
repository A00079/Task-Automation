const { Client, GatewayIntentBits } = require('discord.js');
const { main } = require('./checker');
const express = require('express');
require('dotenv').config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Create HTTP server for Render
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(process.env.PORT || 3000, () => {
  console.log('HTTP server running on port', process.env.PORT || 3000);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log('✅ Discord bot is online and ready!');
  console.log('Type "Jarvis wake up" to run checks...');
});

let isRunning = false;

client.on('messageCreate', async (message) => {
  if (message.channelId === DISCORD_CHANNEL_ID && !message.author.bot) {
    const content = message.content.toLowerCase().trim();
    
    if (content === 'jarvis wake up') {
      if (isRunning) {
        console.log('Already running, ignoring duplicate command');
        return;
      }
      
      isRunning = true;
      console.log('Command received! Starting checks...');
      await message.reply('🚀 Starting NAV and Login checks...');
      
      try {
        await main(client);
      } catch (error) {
        console.error('Error running checks:', error);
      } finally {
        isRunning = false;
      }
    }
    // Don't block other messages when running - needed for OTP
  }
});

client.login(DISCORD_BOT_TOKEN);
