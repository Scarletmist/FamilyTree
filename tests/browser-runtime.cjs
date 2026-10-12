/* Compatibility is confined to historical browser tests, never production. */
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const compatibility = () => {
  Object.defineProperty(window,'FAMILY',{configurable:true,get:() => window.FamilyApp?.graph?.()});
  window.selectFamilyMember = (id,options = {}) => dispatchEvent(new CustomEvent('familytreeselect',{detail:{id,options}}));
  window.renderFamilyTree = () => dispatchEvent(new CustomEvent('familyappchange',{detail:{graph:FamilyApp.graph(),source:'browser-test'}}));
};
module.exports.chromium = {
  async launch(options) {
    const browser = await playwright.chromium.launch(options);
    const newContext = browser.newContext.bind(browser),newPage = browser.newPage.bind(browser);
    browser.newContext = async settings => {const context = await newContext(settings);await context.addInitScript(compatibility);return context;};
    browser.newPage = async settings => {const page = await newPage(settings);await page.addInitScript(compatibility);return page;};
    return browser;
  }
};
