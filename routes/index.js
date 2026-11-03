/*
 * Connect all of your endpoints together here.
 */
var send = require('./helpers').send;

module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api/users', require('./users.js')());
    app.use('/api/tasks', require('./tasks.js')());

    // Unknown endpoints
    app.use(function (req, res) {
        send(res, 404, 'Endpoint not found');
    });

    // Malformed JSON bodies and anything else Express catches
    app.use(function (err, req, res, next) {
        if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
            return send(res, 400, 'The request body is not valid JSON');
        }
        console.error(err);
        send(res, 500, 'Something went wrong on the server. Please try again later.');
    });
};
