var request = require('request');
var _ = require('underscore');
var url = require('url');

var DEFAULT_CRAWL_DEPTH = 5;
var DEFAULT_MAX_PARALLEL_REQUESTS = 5;
var DEFAULT_MAX_REQ_PER_SEC = 5;
var DEFAULT_USER_AGENT = 'test/crawl-Bot';

/*
 * Executor that handles throttling and task processing rate.
 */
function Executor(opts) {
    this.isStopped = false;
    this.maximumRatePerSecond = opts.maximumRatePerSecond;
    this.timeoutMs = (1 / this.maximumRatePerSecond) * 1000;

    this.shouldProceed = opts.shouldProceed || function() {return true;};
    this.queue = [];
    this.onFinished = opts.finished || function() {};
}

Executor.prototype.submit = function(func, context, args, shouldSkip) {
    this.queue.push({
        func: func,
        context: context,
        args: args,
        shouldSkip: shouldSkip
    });
};

Executor.prototype.start = function() {
    this._processQueueItem();
};

Executor.prototype.stop = function() {
    this.isStopped = true;
};

Executor.prototype._processQueueItem = function() {
    var bot = this;

    if (this.shouldProceed()) {
        if (this.queue.length !== 0) {
            var QueueItem = this.queue.shift();
            var shouldSkipNext = (QueueItem.shouldSkip && QueueItem.shouldSkip.call(QueueItem.context));

            if (shouldSkipNext) {
                setTimeout(function() {
                    bot._processQueueItem();
                });
                return;
            } else {
                QueueItem.func.apply(QueueItem.context, QueueItem.args);
            }
        }
    }
    if (this.isStopped) {
        return;
    }
    setTimeout(function() {
        bot._processQueueItem();
    }, this.timeoutMs);
};

/*
 * Main crawler functionality.
 */
function CrawlBot() {

    /*
     * Urls that the Crawler has visited, as some pages may be in the middle of a redirect chain, not all the knownUrls will be actually
     * reported in the onSuccess or onFailure callbacks, only the final urls in the corresponding redirect chains
     */
    this.knownUrls = {};

    /*
     * Urls that were reported in the onSuccess or onFailure callbacks. this.crawledUrls is a subset of this.knownUrls, and matches it
     * iff there were no redirects while crawling.
     */
    this.crawledUrls = [];
    this.ignoreRelative = false;
    this.shouldCrawlUrl = function(url) {
        return true;
    };
    this.shouldCrawlLinksFrom = function(url) {
        return true;
    };
    //Urls that are queued for crawling, for some of them HTTP requests may not yet have been issued
    this._currentUrlsToCrawl = [];
    this._concurrentRequestNumber = 0;

    //Injecting request as a dependency for unit test support
    this.request = request;
}

CrawlBot.prototype.configure = function(options) {
    this.depth = options.defaultCrawlDepth;
    this.userAgent = (options && options.userAgent) || DEFAULT_USER_AGENT;
    this.maximumConcurrentReqs = (options && options.maxConcurrentRequest ) || DEFAULT_MAX_PARALLEL_REQUESTS;
    this.maximumReqsPerSecond = (options && options.maxReqsPerSec ) || DEFAULT_MAX_REQ_PER_SEC;
    this.depth = (options && options.depth) || this.depth;
    this.depth = Math.max(this.depth, 0);
    this.ignoreRelative = (options && options.ignoreRelative) || this.ignoreRelative;
    this.shouldCrawlUrl = (options && options.shouldCrawlUrl) || this.shouldCrawlUrl;
    this.shouldCrawlLinksFrom = (options && options.shouldCrawlLinksFrom) || this.shouldCrawlLinksFrom;
    this.onSuccess = _.noop;
    this.onFailure = _.noop;
    this.onAllFinished = _.noop;
    return this;
};

CrawlBot.prototype._createExecutor = function() {
    var bot = this;

    return new Executor({
        maximumRatePerSecond: this.maximumReqsPerSecond,
        shouldProceed: function() {
            return bot._concurrentRequestNumber < bot.maximumConcurrentReqs;
        }
    });
};

CrawlBot.prototype.crawl = function(url, onSuccess, onFailure, onAllFinished) {
    this.workExecutor = this._createExecutor();
    this.workExecutor.start();

    if (typeof url !== 'string') {
        var options = url;

        onSuccess = options.success;
        onFailure = options.failure;
        onAllFinished = options.finished;
        url = options.url;
    }
    this.onSuccess = onSuccess;
    this.onFailure = onFailure;
    this.onAllFinished = onAllFinished;
    this._crawlUrl(url, null, this.depth);

    return this;
};

CrawlBot.prototype.forgetCrawled = function() {
    this.knownUrls = {};
    this.crawledUrls = [];
    return this;
};

CrawlBot.prototype._startedCrawling = function(url) {
    if (this._currentUrlsToCrawl.indexOf(url) < 0) {
        this._currentUrlsToCrawl.push(url);
    }
};

CrawlBot.prototype._finishedCrawling = function(url) {
    var indexOfUrl = this._currentUrlsToCrawl.indexOf(url);

    this._currentUrlsToCrawl.splice(indexOfUrl, 1);
    if (this._currentUrlsToCrawl.length === 0) {
        this.onAllFinished && this.onAllFinished(this.crawledUrls);
        this.workExecutor && this.workExecutor.stop();
    }
}

CrawlBot.prototype._requestUrl = function(options, callback) {
    // console.log('_requestUrl: options = ', options);
    var bot = this;
    var url = options.url;

    //Do not request a url if it has already been crawled
    if (_.contains(bot._currentUrlsToCrawl, url) || _.contains(bot.knownUrls, url)) {
        return;
    }

    bot._startedCrawling(url);
    this.workExecutor.submit(function(options, callback) {
        bot._concurrentRequestNumber++;
        bot.request(options, function(error, response, body) {
            bot._redirects = this._redirect.redirects;
            callback(error, response, body);
            bot._finishedCrawling(url);
            bot._concurrentRequestNumber--;
        });
    }, null, [options, callback], function shouldSkip() {
        //console.log('Should skip? url = ', url, _.contains(bot.knownUrls, url) || !bot.shouldCrawlUrl(url));
        var shouldCrawlLink = bot.shouldCrawlUrl(url);
        if (!shouldCrawlLink) {
            bot._finishedCrawling(url);
        }
        return _.contains(bot.knownUrls, url) || !shouldCrawlLink;
    });
};

CrawlBot.prototype._crawlUrl = function(url, referer, depth) {
    //console.log('_crawlUrl: url = %s, depth = %s', url, depth);
    if ((depth === 0) || this.knownUrls[url]) {
        return;
    }

    var bot = this;

    this._requestUrl({
        url: url,
        encoding: null, // Added by @tibetty so as to avoid request treating body as a string by default
        rejectUnauthorized : false,
        followRedirect: true,
        followAllRedirects: true,
        headers: {
            'User-Agent': this.userAgent,
            'Referer': referer
        }
    }, function(error, response) {
        if (bot.knownUrls[url]) {
            //Was already crawled while the request has been processed, no need to call callbacks
            return;
        }
        bot.knownUrls[url] = true;
        _.each(bot._redirects, function(redirect) {
            bot.knownUrls[redirect.redirectUri] = true;
        });
        //console.log('analyzing url = ', url);
        var isTextContent = bot._isTextContent(response);
        var body = isTextContent ? bot._getDecodedBody(response) : '<<...binary content (omitted by js-crawler)...>>';

        if (!error && (response.statusCode === 200)) {
            //If no redirects, then response.request.uri.href === url, otherwise last url
            var lastUrlInRedirectChain = response.request.uri.href;
            //console.log('lastUrlInRedirectChain = %s', lastUrlInRedirectChain);
            if (bot.shouldCrawlUrl(lastUrlInRedirectChain)) {
                bot.onSuccess({
                    url: lastUrlInRedirectChain,
                    status: response.statusCode,
                    content: body,
                    error: error,
                    response: response,
                    body: body,
                    referer: referer || ""
                });
                bot.knownUrls[lastUrlInRedirectChain] = true;
                bot.crawledUrls.push(lastUrlInRedirectChain);
                if (bot.shouldCrawlLinksFrom(lastUrlInRedirectChain) && depth > 1 && isTextContent) {
                    bot._crawlUrls(bot._getAllUrls(lastUrlInRedirectChain, body), lastUrlInRedirectChain, depth - 1);
                }
            }
        } else if (bot.onFailure) {
            bot.onFailure({
                url: url,
                status: response ? response.statusCode : undefined,
                content: body,
                error: error,
                response: response,
                body: body,
                referer: referer || ""
            });
            bot.crawledUrls.push(url);
        }
    });
};

CrawlBot.prototype._isTextContent = function(response) {
    return Boolean(response && response.headers && response.headers['content-type']
        && response.headers['content-type'].match(/^text\/html.*$/));
};

CrawlBot.prototype._getDecodedBody = function(response) {
    var defaultEncoding = 'utf8';
    var encoding = defaultEncoding;

    if (response.headers['content-encoding']) {
        encoding = response.headers['content-encoding'];
    }
    //console.log('encoding = "' + encoding + '"');
    var decodedBody;
    try {
        decodedBody = response.body.toString(encoding);
    } catch (decodingError) {
        decodedBody = response.body.toString(defaultEncoding);
    }
    return decodedBody;
};

CrawlBot.prototype._stripComments = function(str) {
    return str.replace(/<!--.*?-->/g, '');
};

CrawlBot.prototype._getBaseUrl = function(defaultBaseUrl, body) {

    /*
     * Resolving the base url following
     * the algorithm from https://www.w3.org/TR/html5/document-metadata.html#the-base-element
     */
    var baseUrlRegex = /<base href="(.*?)">/;
    var baseUrlInPage = body.match(baseUrlRegex);
    if (!baseUrlInPage) {
        return defaultBaseUrl;
    }

    return url.resolve(defaultBaseUrl, baseUrlInPage[1]);
};

CrawlBot.prototype._isLinkProtocolSupported = function(link) {
    return (link.indexOf('://') < 0 && link.indexOf('mailto:') < 0)
        || link.indexOf('http://') >= 0 || link.indexOf('https://') >= 0;
};

CrawlBot.prototype._getAllUrls = function(defaultBaseUrl, body) {
    var bot = this;
    body = this._stripComments(body);
    var baseUrl = this._getBaseUrl(defaultBaseUrl, body);
    var linksRegex = bot.ignoreRelative ? /<a[^>]+?href=["'].*?:\/\/.*?["']/gmi : /<a[^>]+?href=["'].*?["']/gmi;
    var links = body.match(linksRegex) || [];

    //console.log('body = ', body);
    var urls = _.chain(links)
        .map(function(link) {
            var match = /href=[\"\'](.*?)[#\"\']/i.exec(link);

            link = match[1];
            link = url.resolve(baseUrl, link);
            return link;
        })
        .uniq()
        .filter(function(link) {
            return bot._isLinkProtocolSupported(link) && bot.shouldCrawlUrl(link);
        })
        .value();

    //console.log('urls to crawl = ', urls);
    return urls;
};

CrawlBot.prototype._crawlUrls = function(urls, referer, depth) {
    var bot = this;

    _.each(urls, function(url) {
        bot._crawlUrl(url, referer, depth);
    });
};

module.exports = CrawlBot;