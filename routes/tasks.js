var express = require('express');
var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var ApiError = h.ApiError;

// Check the request body and return clean values. Throws 400s; never touches the database.
function validateTaskBody(body) {
    body = body || {};
    var name = body.name, deadline = body.deadline, description = body.description,
        completed = body.completed, assignedUser = body.assignedUser, assignedUserName = body.assignedUserName;

    if (typeof name !== 'string' || name.trim() === '') throw new ApiError(400, 'A task must have a name');

    if (deadline === undefined || deadline === null || deadline === '') throw new ApiError(400, 'A task must have a deadline');
    if (typeof deadline !== 'string' && typeof deadline !== 'number') throw new ApiError(400, 'The deadline must be a valid date');
    // Accept millisecond timestamps sent as strings too (common from form bodies).
    var d = (typeof deadline === 'string' && /^-?\d+$/.test(deadline)) ? new Date(Number(deadline)) : new Date(deadline);
    if (isNaN(d.getTime())) throw new ApiError(400, 'The deadline must be a valid date');

    if (description === undefined || description === null) description = '';
    else if (typeof description === 'number') description = String(description);
    else if (typeof description !== 'string') throw new ApiError(400, 'The description must be text');

    if (completed === undefined || completed === null || completed === '') completed = false;
    else if (completed === 'true') completed = true;
    else if (completed === 'false') completed = false;
    else if (typeof completed !== 'boolean') throw new ApiError(400, 'completed must be true or false');

    if (assignedUser === undefined || assignedUser === null) assignedUser = '';
    if (typeof assignedUser !== 'string') throw new ApiError(400, 'assignedUser must be a user id');
    if (assignedUser !== '' && !h.isValidId(assignedUser)) throw new ApiError(400, 'assignedUser is not a valid user id');

    if (assignedUserName === null || assignedUserName === '') assignedUserName = undefined;
    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
        throw new ApiError(400, 'assignedUserName must be text');
    }
    if (assignedUser === '' && assignedUserName !== undefined && assignedUserName !== 'unassigned') {
        throw new ApiError(400, 'assignedUserName does not match assignedUser');
    }

    return {
        name: name.trim(),
        description: description,
        deadline: d,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUser === '' ? 'unassigned' : assignedUserName
    };
}

// Checks that need the database: the assigned user exists and the name matches.
async function checkAssignedUser(values) {
    if (values.assignedUser === '') return;
    var user = await User.findById(values.assignedUser);
    if (!user) throw new ApiError(404, 'The assigned user does not exist');
    if (values.assignedUserName === undefined) values.assignedUserName = user.name;
    else if (values.assignedUserName !== user.name) throw new ApiError(400, 'assignedUserName does not match the assigned user');
}

// Bring the users' pendingTasks in line with the task (see "Two-way references").
async function syncUsers(task, oldAssignedUser) {
    var taskId = String(task._id);
    if (oldAssignedUser && oldAssignedUser !== task.assignedUser) {
        await User.updateOne({ _id: oldAssignedUser }, { $pull: { pendingTasks: taskId } });
    }
    if (task.assignedUser) {
        var update = task.completed ? { $pull: { pendingTasks: taskId } } : { $addToSet: { pendingTasks: taskId } };
        await User.updateOne({ _id: task.assignedUser }, update);
    }
}

module.exports = function () {
    var router = express.Router();

    router.get('/', h.wrap(function (req, res) {
        return h.listHandler(Task, req, res, 100); // 100 by default
    }));

    router.post('/', h.wrap(async function (req, res) {
        var values = validateTaskBody(req.body);
        await checkAssignedUser(values);
        var task = new Task(values);
        await task.save();
        await syncUsers(task, '');
        return h.send(res, 201, 'Task created', task);
    }));

    router.get('/:id', h.wrap(function (req, res) {
        return h.getOneHandler(Task, 'Task', req, res);
    }));

    router.put('/:id', h.wrap(async function (req, res) {
        var id = req.params.id;
        if (!h.isValidId(id)) throw new ApiError(404, 'Task not found');
        var task = await Task.findById(id);
        if (!task) throw new ApiError(404, 'Task not found');

        var values = validateTaskBody(req.body);
        await checkAssignedUser(values);

        var oldAssignedUser = task.assignedUser;
        task.set(values);
        await task.save();
        await syncUsers(task, oldAssignedUser);
        return h.send(res, 200, 'Task updated', task);
    }));

    router.delete('/:id', h.wrap(async function (req, res) {
        var id = req.params.id;
        if (!h.isValidId(id)) throw new ApiError(404, 'Task not found');
        var task = await Task.findById(id);
        if (!task) throw new ApiError(404, 'Task not found');

        if (task.assignedUser) {
            await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: id } });
        }
        await Task.deleteOne({ _id: id });
        return h.send(res, 200, 'Task deleted', task);
    }));

    return router;
};
