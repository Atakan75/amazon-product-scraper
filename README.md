# Amazon Product Data Scraper
A simplified Amazon data scraper model. Made with [Puppeteer](https://www.npmjs.com/package/puppeteer).

## Installation
To use this module in your project, run:

```bash
# using npm
npm i amazon-product-scraper
# or using yarn
yarn add amazon-product-scraper
# or using pnpm
pnpm i amazon-product-scraper
```

## Usage

```js
import AmazonScraperManager from 'amazon-product-scraper';

const AmazonProductScraper = new AmazonScraperManager({
    amazonRegion: 'co.uk', // You can enter Amazon domain extensions ex: co.uk, ca, mx, com.tr | default: com
    asins: ['B0BC9TWWBH', 'B0BWDKJ2XR', 'B0BTHM4JDN', 'B0CH7CQGPK', 'B0CJPNKZRZ', 'B095X7RV77', ...], // Asin list
    workerCount: 6, // How many asins to scraping at the same time. default: 1
    useMonitor: true, // Monitor showing instant status. default: false
    ocrKey: 'K**1**47*8*89*7' // This is using for Amazon Captcha, You can get from https://ocr.space/ocrapi
});

(async () => {
    await AmazonScraperManager.scrape();
    AmazonScraperManager.exportProductData('amazon-product-data.json');
    const data = AmazonScraperManager.getProductData();
    console.log(data);
})();
```