const { Client, GatewayIntentBits } = require('discord.js');
const { main } = require('./nav-checker');

const DISCORD_BOT_TOKEN = 'MTQ3NTc2MTY3OTU1NDg0MjY2NQ.GgmVrb.GEJGKGTL2QCWwK5SzbGQS_Ou3_9D8CQubSpw1A';
const DISCORD_CHANNEL_ID = '1475754439553056893';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log('✅ Discord bot is online and ready!');
  console.log('Type "Jarvis wake up" to run checks...');
});

client.on('messageCreate', async (message) => {
  if (message.channelId === DISCORD_CHANNEL_ID && !message.author.bot) {
    const content = message.content.toLowerCase().trim();
    
    if (content === 'jarvis wake up') {
      console.log('Command received! Starting checks...');
      await message.reply('🚀 Starting NAV and Login checks...');
      
      try {
        await main();
      } catch (error) {
        console.error('Error running checks:', error);
      }
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
