var express = require('express');
var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var ApiError = h.ApiError;

// Check the request body and return clean values. Throws 400s; never touches the database.
function validateUserBody(body) {
    body = body || {};
    var name = body.name, email = body.email, pending = body.pendingTasks;

    if (typeof name !== 'string' || name.trim() === '') throw new ApiError(400, 'A user must have a name');
    if (typeof email !== 'string' || email.trim() === '') throw new ApiError(400, 'A user must have an email');

    if (pending === undefined || pending === null || pending === '') pending = [];
    else if (typeof pending === 'string') pending = [pending]; // single value from a form body
    if (!Array.isArray(pending)) throw new ApiError(400, 'pendingTasks must be a list of task ids');
    for (var i = 0; i < pending.length; i++) {
        if (!h.isValidId(pending[i])) throw new ApiError(400, 'pendingTasks contains an invalid task id');
    }
    pending = Array.from(new Set(pending));

    return { name: name.trim(), email: email.trim(), pendingTasks: pending };
}

// Checks that need the database: unique email, tasks exist and are pending.
async function checkReferences(values, userId) {
    var emailQuery = { email: values.email };
    if (userId) emailQuery._id = { $ne: userId };
    if (await User.exists(emailQuery)) throw new ApiError(400, 'A user with this email already exists');

    var tasks = await Task.find({ _id: { $in: values.pendingTasks } });
    if (tasks.length !== values.pendingTasks.length) throw new ApiError(404, 'One or more tasks in pendingTasks do not exist');
    if (tasks.some(function (t) { return t.completed; })) {
        throw new ApiError(400, 'A completed task cannot be in pendingTasks');
    }
    return tasks;
}

// Bring the tasks in line with the user's new pendingTasks (see "Two-way references").
async function syncTasks(user, oldPending, tasks) {
    var userId = String(user._id);
    var newPending = user.pendingTasks;

    // Tasks moving from another user: remove them from that user's pendingTasks.
    for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (t.assignedUser && t.assignedUser !== userId) {
            await User.updateOne({ _id: t.assignedUser }, { $pull: { pendingTasks: String(t._id) } });
        }
    }

    // Tasks in the new list: assign to this user.
    if (newPending.length) {
        await Task.updateMany({ _id: { $in: newPending } },
            { $set: { assignedUser: userId, assignedUserName: user.name } });
    }

    // Tasks dropped from the list: unassign.
    var removed = oldPending.filter(function (id) { return newPending.indexOf(id) === -1; });
    if (removed.length) {
        await Task.updateMany({ _id: { $in: removed }, assignedUser: userId },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } });
    }

    // Everything still assigned to this user (completed too) gets the current name.
    await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: user.name } });
}

module.exports = function () {
    var router = express.Router();

    router.get('/', h.wrap(function (req, res) {
        return h.listHandler(User, req, res, 0); // unlimited by default
    }));

    router.post('/', h.wrap(async function (req, res) {
        var values = validateUserBody(req.body);
        var tasks = await checkReferences(values, null);
        var user = new User(values);
        await user.save();
        await syncTasks(user, [], tasks);
        return h.send(res, 201, 'User created', user);
    }));

    router.get('/:id', h.wrap(function (req, res) {
        return h.getOneHandler(User, 'User', req, res);
    }));

    router.put('/:id', h.wrap(async function (req, res) {
        var id = req.params.id;
        if (!h.isValidId(id)) throw new ApiError(404, 'User not found');
        var user = await User.findById(id);
        if (!user) throw new ApiError(404, 'User not found');

        var values = validateUserBody(req.body);
        var tasks = await checkReferences(values, id);

        var oldPending = user.pendingTasks.slice();
        user.name = values.name;
        user.email = values.email;
        user.pendingTasks = values.pendingTasks;
        await user.save();
        await syncTasks(user, oldPending, tasks);
        return h.send(res, 200, 'User updated', user);
    }));

    router.delete('/:id', h.wrap(async function (req, res) {
        var id = req.params.id;
        if (!h.isValidId(id)) throw new ApiError(404, 'User not found');
        var user = await User.findById(id);
        if (!user) throw new ApiError(404, 'User not found');

        await Task.updateMany({ assignedUser: id }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } });
        await User.deleteOne({ _id: id });
        return res.status(204).end();
    }));

    return router;
};
