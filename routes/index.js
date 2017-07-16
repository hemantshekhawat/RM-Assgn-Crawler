var express = require('express');
var router = express.Router();
var csv = require('ya-csv'),
    fs = require('fs'),
    path = require('path'),
    url = require('url');
var CrawlBot = require("../crawlBot.js");
var csvReportPath = path.join(__dirname, '../storage/');


/* GET Start Crawling URLs for the given website. */
/**
 * Sample URL
 *
 * Request: http://localhost:3000
 * Post Body: url=https://medium.com&userAgent=my-bot/crawler&maxConcurrentRequest=5&maxReqsPerSec=5&ignoreRelative=true
 */
router.post('/', function (req, res) {
    var webSite = req.body.webSite || "https://medium.com";
    var userAgent = req.body.userAgent || "test/crawl-bot";
    var maxConcurrentRequest = req.body.maxConcurrentRequest || 5;
    var maxReqsPerSec = req.body.maxReqsPerSec || 5;
    var ignoreRelative = req.body.ignoreRelative || false;

    var csvReportName = 'CrawlReport_.csv';
    var writer = csv.createCsvStreamWriter(fs.createWriteStream(csvReportPath + csvReportName, {'flags': 'a'}));
    writer.writeRecord(['URL']);

    function saveLinks(page) {
        console.log(this._concurrentRequestNumber + "  " + page.url);
        writer.writeRecord([page.url]);
    }

    var crawlBot = new CrawlBot().configure({
        defaultCrawlDepth: 5,
        userAgent: userAgent,
        maxConcurrentRequest: maxConcurrentRequest,
        maxReqsPerSec: maxReqsPerSec,
        ignoreRelative: ignoreRelative
    });
    crawlBot.crawl(webSite, saveLinks);
    res.render('crawling', {title: 'Crawl Bot', isCrawling: true, inputContext: req.body, downloadLink: '/download/'+csvReportName});
});

router.get('/', function (req, res) {
    res.render('index', {title: 'Crawl Bot'});
});


router.get('/download/:csvReport', function (req, res, next) {
    var file = path.join(__dirname, '../storage/') + req.params.csvReport;
    console.log(file);
    res.download(file); // Set disposition and send it.
});
module.exports = router;