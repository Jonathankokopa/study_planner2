const express = require('express');
const { body, param, query: queryValidator, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all tasks for the authenticated user with optional filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      date,
      subject_id,
      completed,
      priority,
      sort = 'due_date',
      order = 'ASC',
      limit = 100,
      offset = 0
    } = req.query;

    // Build query conditions
    const conditions = ['t.user_id = $1'];
    const values = [req.user.id];
    let paramCount = 2;

    if (date) {
      conditions.push(`t.due_date = $${paramCount++}`);
      values.push(date);
    }

    if (subject_id) {
      conditions.push(`t.subject_id = $${paramCount++}`);
      values.push(subject_id);
    }

    if (completed !== undefined) {
      conditions.push(`t.completed = $${paramCount++}`);
      values.push(completed === 'true');
    }

    if (priority) {
      conditions.push(`t.priority = $${paramCount++}`);
      values.push(priority);
    }

    // Validate sort field
    const validSortFields = ['due_date', 'created_at', 'priority', 'title'];
    const sortField = validSortFields.includes(sort) ? sort : 'due_date';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const queryText = `
      SELECT
        t.id, t.title, t.description, t.due_date, t.due_time,
        t.priority, t.estimated_time, t.completed, t.completed_at,
        t.created_at, t.updated_at,
        s.name as subject_name, s.color as subject_color
      FROM tasks t
      JOIN subjects s ON t.subject_id = s.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.${sortField} ${sortOrder}
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    values.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, values);

    res.json({
      tasks: result.rows.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.due_date,
        dueTime: task.due_time,
        priority: task.priority,
        estimatedTime: task.estimated_time,
        completed: task.completed,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        subject: {
          name: task.subject_name,
          color: task.subject_color
        }
      }))
    });

  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create a new task
router.post('/', [
  authenticateToken,
  body('title').trim().isLength({ min: 1, max: 255 }).withMessage('Title must be 1-255 characters'),
  body('subjectId').isUUID().withMessage('Valid subject ID is required'),
  body('dueDate').isISO8601().withMessage('Valid due date is required'),
  body('dueTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format required (HH:MM)'),
  body('priority').optional().isIn(['low', 'medium', 'high']).withMessage('Priority must be low, medium, or high'),
  body('estimatedTime').optional().isInt({ min: 1 }).withMessage('Estimated time must be a positive integer'),
  body('description').optional().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      title,
      subjectId,
      dueDate,
      dueTime,
      priority = 'medium',
      estimatedTime = 30,
      description
    } = req.body;

    // Verify subject belongs to user
    const subjectCheck = await query(
      'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
      [subjectId, req.user.id]
    );

    if (subjectCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    // Create the task
    const result = await query(`
      INSERT INTO tasks (user_id, subject_id, title, description, due_date, due_time, priority, estimated_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, title, description, due_date, due_time, priority, estimated_time, completed, created_at, updated_at
    `, [req.user.id, subjectId, title, description, dueDate, dueTime, priority, estimatedTime]);

    const task = result.rows[0];

    res.status(201).json({
      message: 'Task created successfully',
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.due_date,
        dueTime: task.due_time,
        priority: task.priority,
        estimatedTime: task.estimated_time,
        completed: task.completed,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      }
    });

  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update a task
router.put('/:id', [
  authenticateToken,
  param('id').isUUID().withMessage('Invalid task ID'),
  body('title').optional().trim().isLength({ min: 1, max: 255 }).withMessage('Title must be 1-255 characters'),
  body('subjectId').optional().isUUID().withMessage('Valid subject ID is required'),
  body('dueDate').optional().isISO8601().withMessage('Valid due date is required'),
  body('dueTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format required (HH:MM)'),
  body('priority').optional().isIn(['low', 'medium', 'high']).withMessage('Priority must be low, medium, or high'),
  body('estimatedTime').optional().isInt({ min: 1 }).withMessage('Estimated time must be a positive integer'),
  body('description').optional().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('completed').optional().isBoolean().withMessage('Completed must be a boolean')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { title, subjectId, dueDate, dueTime, priority, estimatedTime, description, completed } = req.body;

    // Check if task exists and belongs to user
    const existingTask = await query(
      'SELECT id, completed FROM tasks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingTask.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // If subjectId is being updated, verify it belongs to user
    if (subjectId) {
      const subjectCheck = await query(
        'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
        [subjectId, req.user.id]
      );

      if (subjectCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Subject not found' });
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (subjectId !== undefined) {
      updates.push(`subject_id = $${paramCount++}`);
      values.push(subjectId);
    }
    if (dueDate !== undefined) {
      updates.push(`due_date = $${paramCount++}`);
      values.push(dueDate);
    }
    if (dueTime !== undefined) {
      updates.push(`due_time = $${paramCount++}`);
      values.push(dueTime);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramCount++}`);
      values.push(priority);
    }
    if (estimatedTime !== undefined) {
      updates.push(`estimated_time = $${paramCount++}`);
      values.push(estimatedTime);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (completed !== undefined) {
      updates.push(`completed = $${paramCount++}`);
      values.push(completed);

      // If marking as completed, set completed_at timestamp
      if (completed && !existingTask.rows[0].completed) {
        updates.push(`completed_at = CURRENT_TIMESTAMP`);
      } else if (!completed) {
        updates.push(`completed_at = NULL`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id, req.user.id);
    const updateQuery = `
      UPDATE tasks
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount++} AND user_id = $${paramCount++}
      RETURNING id, title, description, due_date, due_time, priority, estimated_time, completed, completed_at, created_at, updated_at
    `;

    const result = await query(updateQuery, values);
    const task = result.rows[0];

    res.json({
      message: 'Task updated successfully',
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.due_date,
        dueTime: task.due_time,
        priority: task.priority,
        estimatedTime: task.estimated_time,
        completed: task.completed,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      }
    });

  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete a task
router.delete('/:id', [
  authenticateToken,
  param('id').isUUID().withMessage('Invalid task ID')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;

    // Check if task exists and belongs to user
    const existingTask = await query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingTask.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Delete the task
    await query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, req.user.id]);

    res.json({ message: 'Task deleted successfully' });

  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Mark task as completed/uncompleted
router.patch('/:id/complete', [
  authenticateToken,
  param('id').isUUID().withMessage('Invalid task ID'),
  body('completed').isBoolean().withMessage('Completed must be a boolean')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { completed } = req.body;

    // Check if task exists and belongs to user
    const existingTask = await query(
      'SELECT id, completed FROM tasks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingTask.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Update completion status
    const completedAt = completed ? 'CURRENT_TIMESTAMP' : 'NULL';
    const result = await query(`
      UPDATE tasks
      SET completed = $1, completed_at = ${completedAt}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING id, completed, completed_at
    `, [completed, id, req.user.id]);

    const task = result.rows[0];

    res.json({
      message: `Task ${completed ? 'completed' : 'uncompleted'} successfully`,
      task: {
        id: task.id,
        completed: task.completed,
        completedAt: task.completed_at
      }
    });

  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;