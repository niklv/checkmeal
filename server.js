//Config
var nconf = require('nconf');
nconf.use('memory').argv().env();
if (nconf.get('NODE_ENV') != 'production') {
    nconf.set('NODE_ENV', 'development');
    nconf.add('env_config', {type: 'file', file: './config/development.json'});
}
nconf.add('defaults', {type: 'file', file: './config/default.json'});
nconf.set('NODE_DIR', __dirname);
nconf.set('isWin', require('./utils').isWin);

//libs
var _ = require('lodash');
var fs = require('fs');
var async = require('async');
var express = require('express');
var morgan = require('morgan');
var https = require('https');
var bodyParser = require('body-parser');
var methodOverride = require('method-override');
var compression = require('compression');
//var models = require('./models');
var api = require('./routers/api');
var log = require('./controllers/log')(module);
var db = require('./controllers/db');
var kue = require('./controllers/recognize_kue');

log.info("Start in " + nconf.get("NODE_ENV"));

var app = express();
db.connect();

//app.disable('etag');
app.disable('x-powered-by');
app.use('/', express.static(__dirname + '/static_files'));
app.use(methodOverride());
app.use(bodyParser.json());
app.use(compression());
app.use('/kue/', kue.app);
kue.app.route = kue.app.mountpath;
if (nconf.get('NODE_ENV') != 'production')
    app.use(morgan('dev', {
        stream: { write: function (message, encoding) {
            log.debug(message.replace(/(\r\n|\n|\r)/gm, ""));
        }}
    }));
app.use('/api', api.router);
app.get('/', function (req, res) {
    res.send('<form method="post" action="/api/recognize" enctype="multipart/form-data"><input type="file" name="files" multiple/>' +
        '<br>' +
        '<input type="submit" value="Upload" /></form>');
});
app.use(require('./controllers/error').PageNotFound);
app.use(require('./controllers/error').ErrorHandler);
log.info('Server config complete!');

var httpsServer = https.createServer({
    cert: fs.readFileSync(nconf.get('security:server:cert'), 'utf8'),
    key: fs.readFileSync(nconf.get('security:server:key'), 'utf8')
}, app).listen(nconf.get('https_port'), function () {
    log.info('HTTPS Express server listening on port', nconf.get('https_port'));
    /**
     setTimeout(function after5sec() {
        kue.restartFailedAtShutdownJobs();
    }, 5000);
     */
});

process.on('SIGINT', function () {
    log.info('Caught interrupt signal');
    shutdown();
});

process.on('message', function (msg) {
    if (msg == 'shutdown') {
        log.info('Shutdown signal');
        shutdown();
    }
});

function shutdown() {
    async.series([
        function (done) {
            log.info('Stop server');
            httpsServer.close();
            done();
        },
        kue.shutdown,
        db.disconnect
    ], function (err) {
        log.info('Exit process');
        process.exit(0);
    });
}