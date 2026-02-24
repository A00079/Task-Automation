const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

// Discord Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Login Configuration
const PAN_NUMBER = process.env.PAN_NUMBER;
const PASSCODE = process.env.PASSCODE;

// Function to get expected NAV date (yesterday or Friday if today is Monday)
function getExpectedNAVDate() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  let daysToSubtract = 1;
  if (dayOfWeek === 1) { // Monday
    daysToSubtract = 3; // Go back to Friday
  } else if (dayOfWeek === 0) { // Sunday (shouldn't run, but handle it)
    daysToSubtract = 2; // Go back to Friday
  }
  
  const expectedDate = new Date(today);
  expectedDate.setDate(today.getDate() - daysToSubtract);
  
  return expectedDate;
}

// Function to format date as DD-MMM-YYYY (e.g., 23-Feb-2026)
function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${day}-${month}-${year}`;
}

// Function to check NAV update with existing page
async function checkNAVWithPage(page) {
  try {
    console.log('Navigating to NAV page...');
    
    await page.goto('https://www.motilaloswalmf.com/nav/latest-nav', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    await page.waitForSelector('.table_nav tbody tr', { timeout: 10000 });
    
    const firstRowDate = await page.evaluate(() => {
      const firstRow = document.querySelector('.table_nav tbody tr td:first-child');
      return firstRow ? firstRow.textContent.trim() : null;
    });
    
    console.log(`First row date found: ${firstRowDate}`);
    
    const expectedDate = getExpectedNAVDate();
    const expectedDateStr = formatDate(expectedDate);
    
    console.log(`Expected date: ${expectedDateStr}`);
    console.log(`Actual date: ${firstRowDate}`);
    
    const isUpdated = firstRowDate === expectedDateStr;
    
    return {
      success: true,
      isUpdated,
      expectedDate: expectedDateStr,
      actualDate: firstRowDate
    };
    
  } catch (error) {
    console.error('Error checking NAV:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function to check NAV update
async function checkNAVUpdate() {
  let browser;
  
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });
    
    const page = await browser.newPage();
    const result = await checkNAVWithPage(page);
    await page.close();
    
    return result;
    
  } catch (error) {
    console.error('Error checking NAV:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Function to send Discord message
async function sendDiscordMessage(message) {
  console.log('Discord Message to send:');
  console.log(message);
  
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
    console.log('✅ Discord message sent successfully!');
  } catch (error) {
    console.error('❌ Failed to send Discord message:', error.response?.data || error.message);
  }
}

// Function to wait for OTP from Discord
async function waitForOTP() {
  return new Promise((resolve) => {
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });

    client.once('ready', () => {
      console.log('Discord bot connected, waiting for OTP...');
    });

    client.on('messageCreate', async (msg) => {
      if (msg.channelId === DISCORD_CHANNEL_ID && !msg.author.bot) {
        const otp = msg.content.trim();
        if (/^\d{6}$/.test(otp)) {
          console.log(`OTP received: ${otp}`);
          await client.destroy();
          resolve(otp);
        }
      }
    });

    client.login(DISCORD_BOT_TOKEN);
  });
}

// Function to check login
async function checkLogin(browser) {
  try {
    const page = await browser.newPage();
    console.log('Navigating to login page...');
    
    await page.goto('https://www.motilaloswalmf.com/mutualfund/login', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Enter PAN
    await page.waitForSelector('input[name="panNo"]', { timeout: 10000 });
    await page.type('input[name="panNo"]', PAN_NUMBER);
    console.log('PAN entered');

    // Click Authenticate
    await page.click('button.yg_submitBtn');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Send Discord message for OTP
    await sendDiscordMessage('⏳ **Waiting for OTP**\n\nPlease reply with the 6-digit OTP you received.');

    // Wait for OTP from Discord
    const otp = await waitForOTP();

    // Enter OTP
    await page.waitForSelector('input[name="otp"]', { timeout: 10000 });
    await page.type('input[name="otp"]', otp);
    console.log('OTP entered');

    // Click Submit
    await Promise.all([
      page.click('button.yg_submitBtn'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check current URL
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    // Check for error messages
    const errorMsg = await page.$eval('.error-message', el => el.textContent).catch(() => null);
    if (errorMsg) {
      console.log(`Error on page: ${errorMsg}`);
      throw new Error(`OTP submission failed: ${errorMsg}`);
    }

    // If still on login page, OTP might be wrong
    if (currentUrl.includes('/login') && !currentUrl.includes('/passcode')) {
      throw new Error('Still on login page after OTP submit. OTP might be incorrect or expired.');
    }

    // Enter Passcode
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const passcodeInputs = await page.$$('input[type="password"]');
    for (let i = 0; i < PASSCODE.length; i++) {
      await passcodeInputs[i].type(PASSCODE[i]);
    }
    console.log('Passcode entered');

    // Click Submit
    await page.click('button.yg_submitBtn');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if reached dashboard
    await page.waitForSelector('.zeroBalanceText h3', { timeout: 10000 });
    const userName = await page.$eval('.zeroBalanceText h3', el => el.textContent.trim());
    console.log(`Login successful: ${userName}`);

    await page.close();
    return { success: true, userName };

  } catch (error) {
    console.error('Login check failed:', error);
    return { success: false, error: error.message };
  }
}

// Main execution
async function main() {
  console.log('Starting NAV and Login check...');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    // Check NAV
    const page = await browser.newPage();
    const navResult = await checkNAVWithPage(page);
    await page.close();
    
    // Check Login
    const loginResult = await checkLogin(browser);
    
    // Build message
    let message = 'Good Morning team,\n\nWebsite update\n\n';
    
    if (navResult.success && navResult.isUpdated) {
      message += '1. NAV updated properly\n';
    } else if (navResult.success && !navResult.isUpdated) {
      message += `1. NAV NOT updated (Expected: ${navResult.expectedDate}, Actual: ${navResult.actualDate})\n`;
    } else {
      message += `1. NAV check error: ${navResult.error}\n`;
    }
    
    if (loginResult.success) {
      message += `2. Login working properly (${loginResult.userName})\n`;
    } else {
      message += `2. Login failed: ${loginResult.error}\n`;
    }
    
    message += '\nhttps://www.motilaloswalmf.com/nav/latest-nav';
    
    await sendDiscordMessage(message);
    console.log('Check completed.');
    
  } catch (error) {
    console.error('Error:', error);
    await sendDiscordMessage(`Error: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkNAVUpdate, main };
