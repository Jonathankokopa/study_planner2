const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all subjects for the authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, color, created_at, updated_at FROM subjects WHERE user_id = $1 ORDER BY name',
      [req.user.id]
    );

    res.json({
      subjects: result.rows.map(subject => ({
        id: subject.id,
        name: subject.name,
        color: subject.color,
        createdAt: subject.created_at,
        updatedAt: subject.updated_at
      }))
    });

  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create a new subject
router.post('/', [
  authenticateToken,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Subject name must be 1-100 characters'),
  body('color').optional().isLength({ min: 1, max: 50 }).withMessage('Color must be 1-50 characters')
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

    const { name, color = 'blue-500' } = req.body;

    // Check if subject with same name already exists for this user
    const existingSubject = await query(
      'SELECT id FROM subjects WHERE user_id = $1 AND name = $2',
      [req.user.id, name]
    );

    if (existingSubject.rows.length > 0) {
      return res.status(409).json({ message: 'Subject with this name already exists' });
    }

    // Create the subject
    const result = await query(
      'INSERT INTO subjects (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color, created_at, updated_at',
      [req.user.id, name, color]
    );

    const subject = result.rows[0];

    res.status(201).json({
      message: 'Subject created successfully',
      subject: {
        id: subject.id,
        name: subject.name,
        color: subject.color,
        createdAt: subject.created_at,
        updatedAt: subject.updated_at
      }
    });

  } catch (error) {
    console.error('Create subject error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update a subject
router.put('/:id', [
  authenticateToken,
  param('id').isUUID().withMessage('Invalid subject ID'),
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Subject name must be 1-100 characters'),
  body('color').optional().isLength({ min: 1, max: 50 }).withMessage('Color must be 1-50 characters')
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
    const { name, color } = req.body;

    // Check if subject exists and belongs to user
    const existingSubject = await query(
      'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingSubject.rows.length === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    // If name is being updated, check for duplicates
    if (name) {
      const duplicateCheck = await query(
        'SELECT id FROM subjects WHERE user_id = $1 AND name = $2 AND id != $3',
        [req.user.id, name, id]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({ message: 'Subject with this name already exists' });
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (color !== undefined) {
      updates.push(`color = $${paramCount++}`);
      values.push(color);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id, req.user.id);
    const updateQuery = `
      UPDATE subjects
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount++} AND user_id = $${paramCount++}
      RETURNING id, name, color, created_at, updated_at
    `;

    const result = await query(updateQuery, values);
    const subject = result.rows[0];

    res.json({
      message: 'Subject updated successfully',
      subject: {
        id: subject.id,
        name: subject.name,
        color: subject.color,
        createdAt: subject.created_at,
        updatedAt: subject.updated_at
      }
    });

  } catch (error) {
    console.error('Update subject error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete a subject
router.delete('/:id', [
  authenticateToken,
  param('id').isUUID().withMessage('Invalid subject ID')
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

    // Check if subject exists and belongs to user
    const existingSubject = await query(
      'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingSubject.rows.length === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    // Check if subject has associated tasks
    const tasksCheck = await query(
      'SELECT COUNT(*) as count FROM tasks WHERE subject_id = $1',
      [id]
    );

    if (parseInt(tasksCheck.rows[0].count) > 0) {
      return res.status(409).json({
        message: 'Cannot delete subject with associated tasks. Please delete or reassign tasks first.'
      });
    }

    // Delete the subject
    await query('DELETE FROM subjects WHERE id = $1 AND user_id = $2', [id, req.user.id]);

    res.json({ message: 'Subject deleted successfully' });

  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;