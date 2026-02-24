const puppeteer = require('puppeteer');
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
  // Get current date in IST (UTC+5:30)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istTime = new Date(now.getTime() + istOffset);
  
  const dayOfWeek = istTime.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  
  let daysToSubtract = 1;
  if (dayOfWeek === 1) { // Monday
    daysToSubtract = 3; // Go back to Friday
  } else if (dayOfWeek === 0) { // Sunday (shouldn't run, but handle it)
    daysToSubtract = 2; // Go back to Friday
  }
  
  const expectedDate = new Date(istTime);
  expectedDate.setUTCDate(istTime.getUTCDate() - daysToSubtract);
  
  console.log(`IST Date: ${istTime.toISOString()}, Day: ${dayOfWeek}`);
  
  return expectedDate;
}

// Function to format date as DD-MMM-YYYY (e.g., 23-Feb-2026)
function formatDate(date) {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  
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
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
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
  return new Promise((resolve, reject) => {
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });

    const timeout = setTimeout(async () => {
      await client.destroy();
      reject(new Error('OTP timeout - no response received within 2 minutes'));
    }, 120000); // 2 minutes

    client.once('ready', () => {
      console.log('Discord bot connected, waiting for OTP...');
    });

    client.on('messageCreate', async (msg) => {
      if (msg.channelId === DISCORD_CHANNEL_ID && !msg.author.bot) {
        const otp = msg.content.trim();
        if (/^\d{6}$/.test(otp)) {
          console.log(`OTP received: ${otp}`);
          clearTimeout(timeout);
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
    
    // Make Puppeteer undetectable
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
    });
    
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
    console.log('Waiting for OTP field...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Send Discord message for OTP
    await sendDiscordMessage('⏳ **Waiting for OTP**\n\nPlease reply with the 6-digit OTP you received.');

    // Wait for OTP from Discord
    console.log('Waiting for OTP from Discord...');
    const otp = await waitForOTP();
    console.log(`Got OTP: ${otp}, now entering it...`);

    // Enter OTP
    await page.waitForSelector('input[name="otp"]', { timeout: 10000 });
    await page.type('input[name="otp"]', otp);
    console.log('OTP entered');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Click Submit button (NOT the Resend OTP button)
    console.log('Clicking OTP submit button...');
    const submitButtons = await page.$$('button.yg_submitBtn');
    console.log(`Found ${submitButtons.length} submit buttons`);
    
    // Find the correct Submit button (not the Resend OTP one)
    let correctButton = null;
    for (const btn of submitButtons) {
      const btnText = await page.evaluate(el => el.textContent.trim(), btn);
      const btnClass = await page.evaluate(el => el.className, btn);
      console.log(`Button: "${btnText}" - Class: "${btnClass}"`);
      
      if (btnText.toLowerCase().includes('submit') && !btnClass.includes('yg_resendOTPBtn')) {
        correctButton = btn;
        break;
      }
    }
    
    if (!correctButton) {
      throw new Error('Could not find Submit button');
    }
    
    console.log('Clicking the correct Submit button...');
    await correctButton.click();
    console.log('Waiting for navigation...');
    
    // Wait for either navigation or error message
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => console.log('Navigation timeout')),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    
    console.log('Wait completed');

    // Check current URL
    const currentUrl = page.url();
    console.log(`Current URL after OTP: ${currentUrl}`);

    // Check for error messages on the page
    const errorMsg = await page.evaluate(() => {
      const errorDiv = document.querySelector('.error-message');
      if (errorDiv && errorDiv.textContent.trim()) {
        return errorDiv.textContent.trim();
      }
      
      // Check for any visible error
      const allErrors = Array.from(document.querySelectorAll('.error-message'));
      for (const err of allErrors) {
        const text = err.textContent.trim();
        if (text && text !== 'Please enter OTP' && text !== 'Enter PAN number') {
          return text;
        }
      }
      return null;
    });
    
    if (errorMsg) {
      console.log(`Error message found: ${errorMsg}`);
      throw new Error(`OTP submission failed: ${errorMsg}`);
    }

    // Verify we're on passcode page
    if (!currentUrl.includes('/passcode')) {
      // Take screenshot to see what's on the page
      await page.screenshot({ path: '/tmp/otp-failed.png' });
      console.log('Screenshot saved to /tmp/otp-failed.png');
      
      // Get page content to debug
      const pageText = await page.evaluate(() => {
        return document.querySelector('.yg_loginTitle')?.textContent || 'No title found';
      });
      console.log(`Page title: ${pageText}`);
      
      throw new Error(`Failed to reach passcode page. Still on: ${currentUrl}. OTP might be incorrect or expired.`);
    }
    
    console.log('Successfully reached passcode page!');

    // Enter Passcode
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const passcodeInputs = await page.$$('input[type="password"]');
    for (let i = 0; i < PASSCODE.length; i++) {
      await passcodeInputs[i].type(PASSCODE[i]);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between digits
    }
    console.log('Passcode entered');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Toggle "Discover the New Experience" switch to ON
    console.log('Checking toggle switch...');
    const toggleSwitch = await page.$('input.MuiSwitch-input[type="checkbox"]');
    if (toggleSwitch) {
      const isChecked = await page.evaluate(el => el.checked, toggleSwitch);
      console.log(`Toggle is currently: ${isChecked ? 'ON' : 'OFF'}`);
      
      if (!isChecked) {
        console.log('Turning toggle ON...');
        await toggleSwitch.click();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      console.log('Toggle switch not found');
    }

    // Click Submit button on passcode page
    console.log('Clicking passcode submit button...');
    const passcodeSubmitBtn = await page.$('button.btnsubmit');
    if (!passcodeSubmitBtn) {
      console.log('btnsubmit not found, trying yg_submitBtn');
      await page.click('button.yg_submitBtn');
    } else {
      await passcodeSubmitBtn.click();
    }
    console.log('Submit button clicked, waiting for dashboard...');
    
    // Wait for navigation to dashboard (different domain)
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => console.log('Navigation timeout')),
      new Promise(resolve => setTimeout(resolve, 12000))
    ]);
    console.log('First navigation completed');
    
    // Wait for SSO redirect to complete
    let finalUrl = page.url();
    console.log(`Current URL: ${finalUrl}`);
    
    if (finalUrl.includes('/sso')) {
      console.log('On SSO page, waiting for final redirect...');
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => console.log('SSO redirect timeout')),
        new Promise(resolve => setTimeout(resolve, 15000))
      ]);
      finalUrl = page.url();
      console.log(`Final URL after SSO: ${finalUrl}`);
    }

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if reached dashboard - look for welcome message
    console.log('Looking for username on dashboard...');
    
    // Try to find username on new dashboard
    const userName = await page.evaluate(() => {
      // Try new dashboard format
      const newDash = document.querySelector('.css-nhob99');
      if (newDash) return newDash.textContent.trim();
      
      // Try old dashboard format
      const oldDash = document.querySelector('.zeroBalanceText h3');
      if (oldDash) return oldDash.textContent.trim();
      
      // Try portfolio screen
      const portfolio = document.querySelector('.css-ljufra');
      if (portfolio) return portfolio.textContent.trim();
      
      return null;
    });
    
    if (userName) {
      console.log(`Login successful: ${userName}`);
      await page.close();
      return { success: true, userName };
    } else {
      throw new Error('Reached dashboard but could not find username');
    }

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
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    // Check NAV
    const page = await browser.newPage();
    
    // Make Puppeteer undetectable
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
    });
    
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
      message += `2. Login working properly (${loginResult.userName})`;
    } else {
      message += `2. Login failed: ${loginResult.error}`;
    }
    
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
