var User = require('../models/user');
var Task = require('../models/task');

module.exports = function(router) {

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    // GET /api/users
    usersRoute.get(function(req, res) {
        try {
            // Build query
            var query = User.find();
            
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
            
            // Apply limit (unlimited for users by default)
            if (req.query.limit) {
                query = query.limit(parseInt(req.query.limit));
            }
            
            // Count instead of returning documents
            if (req.query.count === 'true') {
                query.countDocuments().exec(function(err, count) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error counting users",
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
            query.exec(function(err, users) {
                if (err) {
                    return res.status(500).json({
                        message: "Error retrieving users",
                        data: null
                    });
                }
                res.json({
                    message: "OK",
                    data: users
                });
            });
            
        } catch (error) {
            res.status(400).json({
                message: "Invalid query parameters",
                data: null
            });
        }
    });

    // POST /api/users
    usersRoute.post(function(req, res) {
        // Validation
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Name and email are required",
                data: null
            });
        }

        var user = new User({
            name: req.body.name,
            email: req.body.email,
            pendingTasks: req.body.pendingTasks || []
        });

        user.save(function(err, newUser) {
            if (err) {
                if (err.code === 11000) {
                    return res.status(400).json({
                        message: "User with this email already exists",
                        data: null
                    });
                }
                return res.status(500).json({
                    message: "Error creating user",
                    data: null
                });
            }
            res.status(201).json({
                message: "User created successfully",
                data: newUser
            });
        });
    });

    // GET /api/users/:id
    userRoute.get(function(req, res) {
        try {
            var query = User.findById(req.params.id);
            
            // Apply field selection
            if (req.query.select) {
                var selectFields = JSON.parse(req.query.select);
                query = query.select(selectFields);
            }
            
            query.exec(function(err, user) {
                if (err) {
                    return res.status(500).json({
                        message: "Error retrieving user",
                        data: null
                    });
                }
                if (!user) {
                    return res.status(404).json({
                        message: "User not found",
                        data: null
                    });
                }
                res.json({
                    message: "OK",
                    data: user
                });
            });
        } catch (error) {
            res.status(400).json({
                message: "Invalid query parameters",
                data: null
            });
        }
    });

    // PUT /api/users/:id
    userRoute.put(function(req, res) {
        // Validation
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Name and email are required",
                data: null
            });
        }

        User.findById(req.params.id, function(err, user) {
            if (err) {
                return res.status(500).json({
                    message: "Error finding user",
                    data: null
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "User not found",
                    data: null
                });
            }

            // Store old pending tasks for cleanup
            var oldPendingTasks = user.pendingTasks.slice();

            // Update user fields
            user.name = req.body.name;
            user.email = req.body.email;
            user.pendingTasks = req.body.pendingTasks || [];

            user.save(function(err, updatedUser) {
                if (err) {
                    if (err.code === 11000) {
                        return res.status(400).json({
                            message: "User with this email already exists",
                            data: null
                        });
                    }
                    return res.status(500).json({
                        message: "Error updating user",
                        data: null
                    });
                }

                // Handle two-way reference updates
                handleUserTaskReferences(oldPendingTasks, user.pendingTasks, user._id, user.name, function() {
                    res.json({
                        message: "User updated successfully",
                        data: updatedUser
                    });
                });
            });
        });
    });

    // DELETE /api/users/:id
    userRoute.delete(function(req, res) {
        User.findById(req.params.id, function(err, user) {
            if (err) {
                return res.status(500).json({
                    message: "Error finding user",
                    data: null
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "User not found",
                    data: null
                });
            }

            // Unassign user's pending tasks
            Task.updateMany(
                { _id: { $in: user.pendingTasks } },
                { assignedUser: "", assignedUserName: "unassigned" },
                function(err) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error unassigning tasks",
                            data: null
                        });
                    }

                    User.findByIdAndDelete(req.params.id, function(err) {
                        if (err) {
                            return res.status(500).json({
                                message: "Error deleting user",
                                data: null
                            });
                        }
                        res.status(204).json({
                            message: "User deleted successfully",
                            data: null
                        });
                    });
                }
            );
        });
    });

    // Helper function to handle two-way references
    function handleUserTaskReferences(oldTasks, newTasks, userId, userName, callback) {
        // Tasks to remove from user
        var tasksToRemove = oldTasks.filter(taskId => !newTasks.includes(taskId));
        
        // Tasks to add to user
        var tasksToAdd = newTasks.filter(taskId => !oldTasks.includes(taskId));

        // Update tasks being removed
        Task.updateMany(
            { _id: { $in: tasksToRemove } },
            { assignedUser: "", assignedUserName: "unassigned" },
            function(err) {
                if (err) console.error('Error removing task assignments:', err);
                
                // Update tasks being added
                Task.updateMany(
                    { _id: { $in: tasksToAdd } },
                    { assignedUser: userId.toString(), assignedUserName: userName },
                    function(err) {
                        if (err) console.error('Error adding task assignments:', err);
                        callback();
                    }
                );
            }
        );
    }

    return router;
};