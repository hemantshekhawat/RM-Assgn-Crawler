# RM-Assignment Crawler

### Requirement
#### Problem Statement:

Crawl popular blogging website h  ttps://medium.com  and find all possible hyperlinks present within  https://medium.com  website and generate a CSV output.
You need to,
* use Node.js for scripting.
* throttle the requests made to medium.com at max 5 requests at a time.
* use asynchronous nature of javascript as much as possible.
* Using Git with proper commit and readme file is a plus.
* Share two versions of the assignment - One using async library and the other without.
##### Notes:
* Don’t spam medium.com servers with too many requests, their servers might ban your ip
* At all times the concurrency count should be equal to 5
* If you are using request.js, you are not allowed to use its connection pool
* Don’t use any external scraping library
* You are not allowed to use throttled-request package to limit the number of connections



## Solution




### Execution

* Clone the repository  
    `git clone https://github.com/hemantshekhawat/RM-Assgn-Crawler.git`
* Run NPM Install  
    `npm install`
* Execute the Node JS Server on local environment  
    `npm start`
* Open localhost URL in browser   
    `http://localhost:3300`
* Fill up the details required by the Crawler to start execution  
    `Website Name` `User Agent` `Max Concurrent Request` `Max Requests per Second`
    `Ignore the relative URLs or not`
* After form post, you get a Context page which share the details posted and gives option to download the `CSV` file with the latest crawled URLs 