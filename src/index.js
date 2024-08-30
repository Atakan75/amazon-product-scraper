import { Cluster } from 'puppeteer-cluster';
import { ocrSpace } from 'ocr-space-api-wrapper';

import puppeteerExtra from 'puppeteer-extra';
import puppeteerExtraPluginStealth from 'puppeteer-extra-plugin-stealth';

import fs from 'fs';

puppeteerExtra.use(puppeteerExtraPluginStealth());

class AmazonScraper {
    constructor(args) {
        this.amazonRegion = args.amazonRegion || "com";
        this.asins = args.asins;
        this.workerCount = args.workerCount || 1;
        this.useMonitor = args.useMonitor || false;
        this.productData = [];
        this.ocrKey = args.ocrKey;    
    };

    async scrape() {
        const t1 = performance.now();
        if (!this.asins || !this.asins.length) {
            throw new Error("No ASIN's provided");
        }

        if (this.workerCount < 1) {
            throw new Error("Worker count must be greater than 0");
        }
        
        this.scrapingStarted = true;

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            maxConcurrency: this.workerCount,
            retryLimit: 2,
            monitor: this.useMonitor,
            puppeteer: puppeteerExtra,
            puppeteerOptions: {
                headless: false,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                ],
            },
        });

        cluster.on('taskerror', (err, data, willRetry) => {
            if (willRetry) {
              console.warn(`Encountered an error while crawling ${data}. ${err.message}\nThis job will be retried`);
            } else {
              console.error(`Failed to crawl ${data}: ${err.message}`);
            }
        });

        await cluster.task(async ({ page, data: asin }) => {
            await page.setCacheEnabled(true);
            await page.setRequestInterception(true);

            await page.setExtraHTTPHeaders({ 'Accept-Encoding': 'gzip, deflate, br' });

            page.on('request', (request) => {
                if (request.resourceType() !== 'document') {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            await page.goto(`https://amazon.${this.amazonRegion}/dp/${asin}?th=1&psc=1`, { waitUntil: 'domcontentloaded' });
            
            await this.solveCaptcha(page);

            const { sorry_page, product_title, price_text, deal_price_test, image, specs } = await page.evaluate(() => {
                const sorryPage = document.querySelector('#dpSorryPage') || null;

                const productTitle = document.querySelector('#productTitle')?.textContent?.trim() || null;
        
                const strikeElement = document.querySelector('#centerCol [data-a-strike="true"] .a-offscreen');

                const additionalPriceElement = document.querySelector("#gsod_singleOfferDisplay_Desktop")
                    ?.querySelector('#booksAdditionalPriceInfoContainer .a-text-strike');
        
                const priceText = strikeElement ? strikeElement.textContent?.trim() : additionalPriceElement ? additionalPriceElement.textContent?.trim() : '';
        
                const finalPrice = (
                    document.querySelector('#buybox #offerDisplayGroupa-tab-content:not(.a-hidden) ')?.
                        querySelector(
                            '#buyBoxAccordion .a-accordion-active,' +
                            ' [id^="gsod_singleOfferDisplay"] #qualifiedBuybox'
                        )?.
                        querySelector('#corePrice_feature_div .a-offscreen')?.textContent?.trim()
                    || document.querySelector('#buyBoxAccordion .a-accordion-active')?.
                        querySelector('#corePrice_feature_div .a-offscreen, .a-color-price')?.textContent?.trim()
                    || document.querySelector('[id^="gsod_singleOfferDisplay"] #qualifiedBuybox')?.
                        querySelector('#corePrice_feature_div .a-offscreen')?.textContent?.trim()
                    || document.querySelector('#tmmSwatches .swatchElement.selected .a-color-base')?.textContent?.trim()
                    || document.querySelector('#kindle-price')?.textContent?.trim()
                    || document.querySelector('#priceblock_ourprice')?.textContent?.trim()
                    || document.querySelector('#priceblock_dealprice')?.textContent?.trim()
                    || document.querySelector('#priceblock_saleprice')?.textContent?.trim()
                    || document.querySelector('[data-automation-id*="tvod_purchase"]')?.textContent?.trim()
                );

                const imageEl = (document.querySelector('#imgTagWrapperId img')?.getAttribute('src') ||
                    document.querySelector('#img-canvas > img')?.getAttribute('src') ||
                    document.querySelector('#ebooksImgBlkFront')?.getAttribute('src') ||
                    document.querySelector('#ebooks-img-canvas > img')?.getAttribute('src')) || null;
                
                let specs = [];

                let specsEl = document.querySelectorAll('#detailBullets_feature_div li');
                specsEl.forEach((el) => {
                    const key = el.querySelector('.a-list-item > span.a-text-bold')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();

                    if (key && key.includes('Customer Reviews')) {
                        return;
                    }

                    const value = el.querySelector('.a-list-item > span:not([class])')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();
        
                    if (key && value) {
                        specs.push({ key, value });
                    }
                });

                specsEl = document.querySelectorAll('#productOverview_feature_div tbody > tr');
                specsEl.forEach((el) => {
                    const key = el.querySelector('.a-span3 > span')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();

                    if (key && key.includes('Customer Reviews')) {
                        return;
                    }

                    const value = el.querySelector('.a-span9 > span')?.textContent?.trim();

                    if (key && value) {
                        specs.push({ key, value });
                    }
                });

                specsEl = document.querySelectorAll('[id^="productDetails_detailBullets_sections"] tbody > tr:has(td.prodDetAttrValue)');
                specsEl.forEach((el) => {
                    const key = el.querySelector('.prodDetSectionEntry')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();

                    if (key && key.includes('Customer Reviews')) {
                        return;
                    }

                    const value = el.querySelector('.prodDetAttrValue')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();
        
                    if (key && value) {
                        specs.push({ key, value });
                    }
                });

                specsEl = document.querySelectorAll('#prodDetails  .prodDetTable tr');
                specsEl.forEach((el) => {
                    const key = el.querySelector('th')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();

                    if (key && key.includes('Customer Reviews')) {
                        return;
                    }

                    const value = el.querySelector('td')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();
        
                    if (key && value) {
                        specs.push({ key, value });
                    }
                });

                specsEl = document.querySelectorAll('.content-grid-block > .a-bordered > tbody > tr');
                specsEl.forEach((el) => {
                    const key = el.querySelector('td:nth-child(1) > p')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();

                    if (key && key.includes('Customer Reviews')) {
                        return;
                    }

                    const value = el.querySelector('td:nth-child(2) > p')
                        ?.textContent?.replace(/([:\u200F\u200E\f\n\r\t\v]| {2,})/g, "").trim();
        
                    if (key && value) {
                        specs.push({ key, value });
                    }
                });
        
                return {
                    sorry_page: sorryPage ? true : false,
                    product_title: productTitle,
                    price_text: priceText ? priceText
                        .replace(/(\.|,)(\d{3})/g, "$2")
                        .replace(/(\.|,)(\d{2}\D*)$/, "." + "$2")
                        .replace(/[^0-9.]/g, "")
                        .trim() : null,
                    deal_price_test: finalPrice ? finalPrice
                        ?.replace(/(\.|,)(\d{3})/g, "$2")
                        .replace(/(\.|,)(\d{2}\D*)$/, "." + "$2")
                        .replace(/[^0-9.]/g, "")
                        .trim() : null,
                    image: imageEl || null,
                    specs
                };
            });

            if (sorry_page) {
                console.log(`Sorry page for ASIN: ${asin}`);
                this.productData.push({
                    asin,
                    error: [
                        'Sorry page'
                    ]
                });
                return;
            }

            this.productData.push({
                asin,
                product_title,
                price_text,
                deal_price_test,
                image,
                specs
            });

            await page.close();
        });

        for (let i = 0; i < this.asins.length; i++) {
            await cluster.queue(this.asins[i]);
        }

        await cluster.idle();
        await cluster.close();

        const t2 = performance.now();
        console.log(`Scraping took ${((t2 - t1) / 1000).toFixed(2)} seconds`);

        return this.productData;
    };

    getProductData() {
        if (!this.scrapingStarted) {
            throw new Error('Start scraping before using functions.');
        }
        return this.productData;
    };

    exportProductData(dictionary) {
        if (!this.scrapingStarted) {
            throw new Error('Start scraping before using functions.');
        }
        fs.writeFileSync(dictionary, JSON.stringify(this.productData, null, 4));
    };

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    async solveCaptcha(page) {
        const [body] = await Promise.all([
            page.content()
        ]);
    
        if (!body.includes('Enter the characters you see below')) {
            return true;
        }
    
        const previousUrl = page.url();
    
        const image = await page.$('.a-row.a-text-center img');
        const src = await page.evaluate((image) => image.src, image);
        console.log(src);

        const res2 = await ocrSpace(src.toString(), { apiKey: this.ocrKey, OCREngine: '2' });
        
        const captchaText = res2.ParsedResults[0].ParsedText.split('\r\n').join(' ').trim();
        console.log(captchaText);

        await page.waitForSelector('#captchacharacters');
        await page.type('#captchacharacters', captchaText);
        await page.click('button[type="submit"][class="a-button-text"]');
    
        const isUrlChanged = await page.waitForFunction((previousUrl) => {
            return window.location.href !== previousUrl;
        }, { polling: 'raf', timeout: 700 }, previousUrl).then(() => {
            return true;
        }).catch(() => {
            return false;
        });
    
        if (isUrlChanged && page.url().includes('validateCaptcha')) {
            return await this.solveCaptcha(page);
        }
    
        await this.sleep(2500);
    
        return true;
    };
}

export default AmazonScraper;
