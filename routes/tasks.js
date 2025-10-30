var Task = require('../models/task');
var User = require('../models/user');

module.exports = function(router) {

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    // GET /api/tasks
    tasksRoute.get(function(req, res) {
        try {
            // Build query
            var query = Task.find();
            
            // Apply where filter
            if (req.query.where) {
                var whereConditions = JSON.parse(req.query.where);
                query = query.where(whereConditions);
            }
            
            // Apply sorting
            if (req.query.sort) {
                var sortConditions = JSON.parse(req.query.sort);
                query = query.sort(sortConditions);
            }
            
            // Apply field selection
            if (req.query.select) {
                var selectFields = JSON.parse(req.query.select);
                query = query.select(selectFields);
            }
            
            // Apply skip
            if (req.query.skip) {
                query = query.skip(parseInt(req.query.skip));
            }
            
            // Apply limit (default 100 for tasks)
            var limit = req.query.limit ? parseInt(req.query.limit) : 100;
            query = query.limit(limit);
            
            // Count instead of returning documents
            if (req.query.count === 'true') {
                var countQuery = Task.find();
                if (req.query.where) {
                    var whereConditions = JSON.parse(req.query.where);
                    countQuery = countQuery.where(whereConditions);
                }
                
                countQuery.countDocuments().exec(function(err, count) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error counting tasks",
                            data: null
                        });
                    }
                    res.json({
                        message: "OK",
                        data: count
                    });
                });
                return;
            }
            
            // Execute query
            query.exec(function(err, tasks) {
                if (err) {
                    return res.status(500).json({
                        message: "Error retrieving tasks",
                        data: null
                    });
                }
                res.json({
                    message: "OK",
                    data: tasks
                });
            });
            
        } catch (error) {
            res.status(400).json({
                message: "Invalid query parameters",
                data: null
            });
        }
    });

    // POST /api/tasks
    tasksRoute.post(function(req, res) {
        // Validation
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Name and deadline are required",
                data: null
            });
        }

        var task = new Task({
            name: req.body.name,
            description: req.body.description || "",
            deadline: req.body.deadline,
            completed: req.body.completed || false,
            assignedUser: req.body.assignedUser || "",
            assignedUserName: req.body.assignedUserName || "unassigned"
        });

        task.save(function(err, newTask) {
            if (err) {
                return res.status(500).json({
                    message: "Error creating task",
                    data: null
                });
            }

            // Handle two-way reference if task is assigned
            if (newTask.assignedUser && newTask.assignedUser !== "") {
                User.findById(newTask.assignedUser, function(err, user) {
                    if (!err && user) {
                        if (!user.pendingTasks.includes(newTask._id.toString())) {
                            user.pendingTasks.push(newTask._id.toString());
                            user.save();
                        }
                    }
                });
            }

            res.status(201).json({
                message: "Task created successfully",
                data: newTask
            });
        });
    });

    // GET /api/tasks/:id
    taskRoute.get(function(req, res) {
        try {
            var query = Task.findById(req.params.id);
            
            // Apply field selection
            if (req.query.select) {
                var selectFields = JSON.parse(req.query.select);
                query = query.select(selectFields);
            }
            
            query.exec(function(err, task) {
                if (err) {
                    return res.status(500).json({
                        message: "Error retrieving task",
                        data: null
                    });
                }
                if (!task) {
                    return res.status(404).json({
                        message: "Task not found",
                        data: null
                    });
                }
                res.json({
                    message: "OK",
                    data: task
                });
            });
        } catch (error) {
            res.status(400).json({
                message: "Invalid query parameters",
                data: null
            });
        }
    });

    // PUT /api/tasks/:id
    taskRoute.put(function(req, res) {
        // Validation
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Name and deadline are required",
                data: null
            });
        }

        Task.findById(req.params.id, function(err, task) {
            if (err) {
                return res.status(500).json({
                    message: "Error finding task",
                    data: null
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Task not found",
                    data: null
                });
            }

            // Store old assigned user for reference cleanup
            var oldAssignedUser = task.assignedUser;

            // Update task fields
            task.name = req.body.name;
            task.description = req.body.description || "";
            task.deadline = req.body.deadline;
            task.completed = req.body.completed !== undefined ? req.body.completed : task.completed;
            task.assignedUser = req.body.assignedUser || "";
            task.assignedUserName = req.body.assignedUserName || "unassigned";

            task.save(function(err, updatedTask) {
                if (err) {
                    return res.status(500).json({
                        message: "Error updating task",
                        data: null
                    });
                }

                // Handle two-way reference updates
                handleTaskUserReferences(oldAssignedUser, task.assignedUser, task._id, function() {
                    res.json({
                        message: "Task updated successfully",
                        data: updatedTask
                    });
                });
            });
        });
    });

    // DELETE /api/tasks/:id
    taskRoute.delete(function(req, res) {
        Task.findById(req.params.id, function(err, task) {
            if (err) {
                return res.status(500).json({
                    message: "Error finding task",
                    data: null
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Task not found",
                    data: null
                });
            }

            // Remove task from assigned user's pendingTasks
            if (task.assignedUser && task.assignedUser !== "") {
                User.findById(task.assignedUser, function(err, user) {
                    if (!err && user) {
                        user.pendingTasks = user.pendingTasks.filter(
                            taskId => taskId !== task._id.toString()
                        );
                        user.save();
                    }
                });
            }

            Task.findByIdAndDelete(req.params.id, function(err) {
                if (err) {
                    return res.status(500).json({
                        message: "Error deleting task",
                        data: null
                    });
                }
                res.status(204).json({
                    message: "Task deleted successfully",
                    data: null
                });
            });
        });
    });

    // Helper function to handle two-way references
    function handleTaskUserReferences(oldUserId, newUserId, taskId, callback) {
        // Remove task from old user
        if (oldUserId && oldUserId !== "" && oldUserId !== newUserId) {
            User.findById(oldUserId, function(err, oldUser) {
                if (!err && oldUser) {
                    oldUser.pendingTasks = oldUser.pendingTasks.filter(
                        tid => tid !== taskId.toString()
                    );
                    oldUser.save();
                }
            });
        }

        // Add task to new user
        if (newUserId && newUserId !== "" && newUserId !== oldUserId) {
            User.findById(newUserId, function(err, newUser) {
                if (!err && newUser) {
                    if (!newUser.pendingTasks.includes(taskId.toString())) {
                        newUser.pendingTasks.push(taskId.toString());
                        newUser.save();
                    }
                }
                callback();
            });
        } else {
            callback();
        }
    }

    return router;
};