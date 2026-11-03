// Shared helpers for the users and tasks routes.

// Every response is { message, data }.
function send(res, status, message, data) {
    return res.status(status).json({ message: message, data: data === undefined ? null : data });
}

// An error we raise on purpose; the status and message are safe to show to the client.
class ApiError extends Error {
    constructor(status, message, data) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

// A valid MongoDB ObjectId: exactly 24 hex characters.
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Parse a JSON-encoded query string parameter (where, sort, select).
function parseJsonParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') throw new ApiError(400, 'Invalid value for the "' + name + '" parameter');
    try {
        var value = JSON.parse(raw);
    } catch (e) {
        throw new ApiError(400, 'The "' + name + '" parameter must be valid JSON');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, 'The "' + name + '" parameter must be a JSON object');
    }
    return value;
}

// Parse skip / limit: a non-negative integer.
function parseIntParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    var n = Number(raw);
    if (typeof raw !== 'string' || raw.trim() === '' || !Number.isInteger(n) || n < 0) {
        throw new ApiError(400, 'The "' + name + '" parameter must be a non-negative integer');
    }
    return n;
}

// Parse count: true / false.
function parseCount(query) {
    var raw = query.count;
    if (raw === undefined || raw === 'false') return false;
    if (raw === 'true') return true;
    throw new ApiError(400, 'The "count" parameter must be true or false');
}

// Errors caused by a bad query (e.g. a where value of the wrong type) rather than a server failure.
function isQueryError(err) {
    return err && (err.name === 'CastError' || err.name === 'StrictModeError' ||
        err.name === 'MongoServerError' || err.name === 'ValidationError');
}

// GET on a collection, with where / sort / select / skip / limit / count.
async function listHandler(Model, req, res, defaultLimit) {
    var where = parseJsonParam(req.query, 'where') || {};
    var sort = parseJsonParam(req.query, 'sort');
    var select = parseJsonParam(req.query, 'select');
    var skip = parseIntParam(req.query, 'skip');
    var limit = parseIntParam(req.query, 'limit');
    var count = parseCount(req.query);

    try {
        if (count) {
            var n = await Model.countDocuments(where);
            return send(res, 200, 'OK', n);
        }
        var q = Model.find(where);
        if (sort) q = q.sort(sort);
        if (select) q = q.select(select);
        if (skip !== undefined) q = q.skip(skip);
        if (limit !== undefined) q = q.limit(limit);
        else if (defaultLimit) q = q.limit(defaultLimit);
        var docs = await q.exec();
        return send(res, 200, 'OK', docs);
    } catch (err) {
        if (isQueryError(err)) throw new ApiError(400, 'Invalid query parameters');
        throw err;
    }
}

// GET on a single resource by id, with select.
async function getOneHandler(Model, label, req, res) {
    var id = req.params.id;
    if (!isValidId(id)) throw new ApiError(404, label + ' not found');
    var select = parseJsonParam(req.query, 'select');
    try {
        var q = Model.findById(id);
        if (select) q = q.select(select);
        var doc = await q.exec();
        if (!doc) throw new ApiError(404, label + ' not found');
        return send(res, 200, 'OK', doc);
    } catch (err) {
        if (isQueryError(err)) throw new ApiError(400, 'Invalid select parameter');
        throw err;
    }
}

// Wrap an async route so ApiErrors become clean responses and anything else becomes a 500.
function wrap(fn) {
    return async function (req, res) {
        try {
            await fn(req, res);
        } catch (err) {
            if (err instanceof ApiError) return send(res, err.status, err.message, err.data);
            if (err && err.code === 11000) return send(res, 400, 'A user with this email already exists');
            console.error(err);
            return send(res, 500, 'Something went wrong on the server. Please try again later.');
        }
    };
}

module.exports = {
    send: send,
    ApiError: ApiError,
    isValidId: isValidId,
    listHandler: listHandler,
    getOneHandler: getOneHandler,
    wrap: wrap
};
