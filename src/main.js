/*jshint esversion: 6 */
const https = require('https');
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");

const databox = require('node-databox');

//some defaults
const DefaultTwitConfig = require('./twitter-secret.json');
const HASH_TAGS_TO_TRACK = ['#raspberrypi', '#mozfest', '#databox', '#iot']; 

const twitter = require('./twitter.js')();

//Databox Env Vars
const DATABOX_STORE_BLOB_ENDPOINT = process.env.DATABOX_DRIVER_TWITTER_STREAM_DATABOX_STORE_BLOB_ENDPOINT;
const HTTPS_SERVER_CERT = process.env.HTTPS_SERVER_CERT || '';
const HTTPS_SERVER_PRIVATE_KEY = process.env.HTTPS_SERVER_PRIVATE_KEY || '';
const credentials = {
	key:  HTTPS_SERVER_PRIVATE_KEY,
	cert: HTTPS_SERVER_CERT,
};
const PORT = process.env.port || '8080';

/*var allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    res.header('Content-Type', 'application/json');
    next();
};*/

var app = express();

app.use(bodyParser.urlencoded({ extended: true }));

app.use('/ui', express.static('./src/www'));
app.set('views', './src/views');
app.set('view engine', 'pug');

app.get('/ui', function(req, res) {
  getSettings()
    .then((settings)=>{
      settings.hashTags = settings.hashTags.join(',');
      console.log("[/ui render]");   
      res.render('index', settings);
    })
    .catch((error)=>{
      console.log("[/ui] Error ",error);
    });
});

app.get('/ui/setCreds', function(req, res) {
  
  getSettings()
    .then((settings)=>{
      settings.consumer_key = res.query.consumer_key;
      settings.consumer_secret = res.query.consumer_secret;
      settings.access_token = res.query.access_token;
      settings.access_token_secret = res.query.access_token_secret;
      console.log("[NEW SETTINGS]",settings);
      return setSettings(settings);
    })
    .then((settings)=>{
      return twitter.connect(settings);
    })
    .then((T)=>{
        stopAllStreams();
        monitorTwitterEvents(T);
        res.status(200).send({statusCode:200, body:"ok"});
    })
    .catch((error)=>{
      console.log("[setCreds] Error ",error);
      res.status(400).send({statusCode:400, body:"error setting setCreds"});
    });
});

app.get('/ui/setHashTags', function(req, res) {
    let newHashTags  = req.query.hashTags;
    console.log(newHashTags);
    getSettings()
    .then((settings)=>{
      settings.hashTags = newHashTags.split(',');
      console.log("[SETTINGS]",settings);
      return setSettings(settings);
    })
    .then((settings)=>{
      return twitter.connect(settings);
    })
    .then((T)=>{
        stopAllStreams();
        monitorTwitterEvents(T);
        res.status(200).send({statusCode:200, body:"ok"});
    })
    .catch((error)=>{
      console.log("[setHashTags] Error ",error);
      res.status(400).send({statusCode:400, body:"error setting hashtags"});
    });

});

app.get("/status", function(req, res) {
    res.send("active");
});

var T = null;

var vendor = "databox";

  databox.waitForStoreStatus(DATABOX_STORE_BLOB_ENDPOINT,'active',10)
  .then(() => {
    //register datasources
    proms = [
      databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
        description: 'Twitter user timeline data',
        contentType: 'text/json',
        vendor: 'Databox Inc.',
        type: 'twitterUserTimeLine',
        datasourceid: 'twitterUserTimeLine',
        storeType: 'databox-store-blob'
      }),

      databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
        description: 'Twitter hashtag data',
        contentType: 'text/json',
        vendor: 'Databox Inc.',
        type: 'twitterHashTagStream',
        datasourceid: 'twitterHashTagStream',
        storeType: 'databox-store-blob'
      }),

      databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
        description: 'Twitter users direct messages',
        contentType: 'text/json',
        vendor: 'Databox Inc.',
        type: 'twitterDirectMessage',
        datasourceid: 'twitterDirectMessage',
        storeType: 'databox-store-blob'
      }),

      databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
        description: 'Twitter users retweets',
        contentType: 'text/json',
        vendor: 'Databox Inc.',
        type: 'twitterRetweet',
        datasourceid: 'twitterRetweet',
        storeType: 'databox-store-blob'
      }),

      databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
        description: 'Twitter users favorite tweets',
        contentType: 'text/json',
        vendor: 'Databox Inc.',
        type: 'twitterFavorite',
        datasourceid: 'twitterFavorite',
        storeType: 'databox-store-blob'
      }),

      databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
        description: 'Test Actuator',
        contentType: 'text/json',
        vendor: 'Databox Inc.',
        type: 'testActuator',
        datasourceid: 'testActuator',
        storeType: 'databox-store-blob',
        isActuator:true
      }),

      databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
        description: 'Twitter driver settings',
        contentType: 'text/json',
        vendor: 'Databox Inc.',
        type: 'twitterSettings',
        datasourceid: 'twitterSettings',
        storeType: 'databox-store-blob',
      })

    ];
    
    return Promise.all(proms);
  })
  .then(()=>{
    return getSettings();
  })
  .then((settings)=>{
    console.log("[Creating server] and twitter Auth");
    https.createServer(credentials, app).listen(PORT);

    console.log("Twitter Auth");
    return twitter.connect(settings);
  })
  .then((T)=>{

    //deal with the actuator
    var actuationEmitter = null; 
    databox.subscriptions.connect(DATABOX_STORE_BLOB_ENDPOINT)
    .catch((err)=>{
      console.log("[Actuation connect error]",err);
    })
    .then((eventEmitter)=>{
      actuationEmitter = eventEmitter;
      return databox.subscriptions.subscribe(DATABOX_STORE_BLOB_ENDPOINT,'testActuator','ts');
    })
    .catch((err)=>{
      console.log("[Actuation subscribe error]",err);
    })
    .then(()=>{
      actuationEmitter.on('data',(endpointHost, actuatorId, data)=>{
        console.log("[Actuation] data received",endpointHost, actuatorId, data);
      });
    })
    .catch((err)=>{
      console.log("[Actuation error]",err);
    });

    monitorTwitterEvents(T);
    
  })
  .catch((err) => {
    console.log("[ERROR]",err);
  });

module.exports = app;


var streams = [];
const monitorTwitterEvents = (twit)=>{

      //deal with twitter events 
    var HashtagStream = twit.stream('statuses/filter', { track: HASH_TAGS_TO_TRACK , language:'en'});
    streams.push(HashtagStream);
    HashtagStream.on('tweet', function (tweet) {
      save('twitterHashTagStream', tweet);
    });
    
    var UserStream = twit.stream('user', { stringify_friend_ids: true, with: 'followings', replies:'all' });
    streams.push(UserStream);
    UserStream.on('tweet', function (event) {
      save('twitterUserTimeLine',event);
    });

    UserStream.on('favorite', function (event) {
      save('twitterFavorite',event);
    });

    UserStream.on('quoted_tweet', function (event) {
      save('twitterRetweet',event);
    });

    UserStream.on('retweeted_retweet', function (event) {
      save('twitterRetweet',event);
    });

    UserStream.on('direct_message', function (event) {
      save('twitterDirectMessage',event);
    });
};

const stopAllStreams = () => {
  streams.map((st)=>{st.stop();});
  streams = [];
}

const getSettings = () => {
 endpoint = DATABOX_STORE_BLOB_ENDPOINT;
 datasourceid = 'twitterSettings';
 return new Promise((resolve,reject)=>{

   databox.keyValue.read(endpoint,datasourceid)
   .then((settings)=>{
     if(settings.status && settings.status == 404) {
      return Promise.reject('No setting found.');
     }
     console.log("[getSettings]",settings);
     resolve(settings);
   })
   .catch((err)=>{
     //return defaults
     let settings = DefaultTwitConfig;
     settings.hashTags = HASH_TAGS_TO_TRACK;
     console.log("[getSettings] using defaults ",err, ' Using ----> ', settings);
     resolve(settings);
   });

 });
}

const setSettings = (settings) => {
 let endpoint = DATABOX_STORE_BLOB_ENDPOINT;
 let datasourceid = 'twitterSettings';
 return new Promise((resolve,reject)=>{

   databox.keyValue.write(endpoint,datasourceid,settings)
   .then(()=>{
     console.log('[setSettings] settings saved', settings);
     resolve(settings);
   })
   .catch((err)=>{
     console.log("Error setting settings", err);
     reject(err);
   });

 });
};

const save = (datasourceid,data) => {
  console.log("Saving data::", datasourceid, data.text);
  databox.timeseries.write(DATABOX_STORE_BLOB_ENDPOINT, datasourceid, data)
  .catch((error)=>{
    console.log("[Error writing to store]", error);
  });
}