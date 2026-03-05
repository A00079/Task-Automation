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

// Add error handler for Discord client
client.on('error', (error) => {
  console.error('Discord client error:', error.message);
  // Don't crash, just log the error
});

client.once('ready', () => {
  console.log('✅ Discord bot is online and ready!');
  console.log('Type "Jarvis wake up" to run checks...');
});

let isRunning = false;
let awaitingPAN = false;
let awaitingPasscode = false;
let awaitingKFintech = false;
let userCredentials = { pan: null, passcode: null, kfintechAUM: null, kfintechCost: null };

client.on('messageCreate', async (message) => {
  if (message.channelId === DISCORD_CHANNEL_ID && !message.author.bot) {
    const content = message.content.trim();
    
    // Handle PAN input
    if (awaitingPAN) {
      userCredentials.pan = content.toUpperCase(); // Convert to uppercase
      awaitingPAN = false;
      awaitingPasscode = true;
      await message.reply('✅ PAN received. Please enter your PASSCODE (4 digits):');
      return;
    }
    
    // Handle Passcode input
    if (awaitingPasscode) {
      userCredentials.passcode = content;
      awaitingPasscode = false;
      awaitingKFintech = true;
      await message.reply('✅ Passcode received. Please enter KFintech values:\n\nFormat: `Assets_Under_Management Cost_Value`\nExample: `1660.12 1511.53`');
      return;
    }
    
    // Handle KFintech values input
    if (awaitingKFintech) {
      const match = content.match(/^([\d,]+\.?\d*)\s*[,\s]\s*([\d,]+\.?\d*)$/);
      if (match) {
        userCredentials.kfintechAUM = parseFloat(match[1].replace(/,/g, ''));
        userCredentials.kfintechCost = parseFloat(match[2].replace(/,/g, ''));
        awaitingKFintech = false;
        
        console.log('Credentials received, starting checks...');
        await message.reply('🚀 Starting checks with provided credentials...');
        
        try {
          await main(client, userCredentials.pan, userCredentials.passcode, userCredentials.kfintechAUM, userCredentials.kfintechCost);
        } catch (error) {
          console.error('Error running checks:', error);
        } finally {
          isRunning = false;
          userCredentials = { pan: null, passcode: null, kfintechAUM: null, kfintechCost: null };
        }
      } else {
        await message.reply('❌ Invalid format. Please use: `AUM Cost_Value`\nExample: `1660.12 1511.53`');
      }
      return;
    }
    
    // Handle wake up command
    if (content.toLowerCase() === 'jarvis wake up') {
      if (isRunning) {
        console.log('Already running, ignoring duplicate command');
        return;
      }
      
      isRunning = true;
      awaitingPAN = true;
      console.log('Command received! Requesting credentials...');
      await message.reply('👋 Hello! Please enter your PAN NUMBER:');
      return;
    }
    // Don't block other messages when running - needed for OTP
  }
});

client.login(DISCORD_BOT_TOKEN).catch(error => {
  console.error('Failed to login to Discord:', error.message);
  process.exit(1);
});
