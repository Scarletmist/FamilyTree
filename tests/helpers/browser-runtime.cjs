const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function launchBrowser() {
  const name = process.env.PLAYWRIGHT_ENGINE || process.env.PLAYWRIGHT_BROWSER || 'chromium';
  if (!['chromium','firefox','webkit'].includes(name)) throw new Error('Unsupported browser: ' + name);
  const options = {headless:true};
  if (process.env.PLAYWRIGHT_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
  else if (name === 'chromium') {
    const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'bundled');
    if (channel !== 'bundled') options.channel = channel;
  }
  const browser = await playwright[name].launch(options);
  console.log('BROWSER '+name+' '+browser.version());
  return browser;
}
module.exports = {launchBrowser};
