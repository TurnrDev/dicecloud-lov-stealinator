const { chromium } = require("playwright");

async function main() {
    const browser = await chromium.connectOverCDP(
        "http://127.0.0.1:9222"
    );

    const contexts = browser.contexts();
    const pages = contexts.flatMap(context => context.pages());

    console.log(pages.map(page => page.url()));

    const page = pages.find(page =>
        page.url().includes("dicecloud")
    );

    if (!page) {
        throw new Error("No DiceCloud tab found");
    }

    const result = await page.evaluate(() => {
        return Mongo.Collection.getAll().map(x => ({
            name: x.name,
            count: x.instance?.find?.().count?.(),
        }));
    });

    console.log(result);

    await browser.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
