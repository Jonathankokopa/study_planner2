const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all study sessions for the authenticated user with optional filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      date,
      subject_id,
      start_date,
      end_date,
      sort = 'session_date',
      order = 'DESC',
      limit = 100,
      offset = 0
    } = req.query;

    // Build query conditions
    const conditions = ['ss.user_id = $1'];
    const values = [req.user.id];
    let paramCount = 2;

    if (date) {
      conditions.push(`ss.session_date = $${paramCount++}`);
      values.push(date);
    }

    if (subject_id) {
      conditions.push(`ss.subject_id = $${paramCount++}`);
      values.push(subject_id);
    }

    if (start_date) {
      conditions.push(`ss.session_date >= $${paramCount++}`);
      values.push(start_date);
    }

    if (end_date) {
      conditions.push(`ss.session_date <= $${paramCount++}`);
      values.push(end_date);
    }

    // Validate sort field
    const validSortFields = ['session_date', 'start_time', 'duration', 'created_at'];
    const sortField = validSortFields.includes(sort) ? sort : 'session_date';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const queryText = `
      SELECT
        ss.id, ss.session_date, ss.start_time, ss.duration, ss.notes,
        ss.created_at, ss.updated_at,
        s.name as subject_name, s.color as subject_color
      FROM study_sessions ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ss.${sortField} ${sortOrder}, ss.start_time ${sortOrder}
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    values.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, values);

    res.json({
      sessions: result.rows.map(session => ({
        id: session.id,
        sessionDate: session.session_date,
        startTime: session.start_time,
        duration: session.duration,
        notes: session.notes,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        subject: {
          name: session.subject_name,
          color: session.subject_color
        }
      }))
    });

  } catch (error) {
    console.error('Get study sessions error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create a new study session
router.post('/', [
  authenticateToken,
  body('subjectId').isUUID().withMessage('Valid subject ID is required'),
  body('sessionDate').isISO8601().withMessage('Valid session date is required'),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format required (HH:MM)'),
  body('duration').isInt({ min: 1 }).withMessage('Duration must be a positive integer (minutes)'),
  body('notes').optional().isLength({ max: 1000 }).withMessage('Notes must be less than 1000 characters')
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

    const { subjectId, sessionDate, startTime, duration, notes } = req.body;

    // Verify subject belongs to user
    const subjectCheck = await query(
      'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
      [subjectId, req.user.id]
    );

    if (subjectCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    // Create the study session
    const result = await query(`
      INSERT INTO study_sessions (user_id, subject_id, session_date, start_time, duration, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, session_date, start_time, duration, notes, created_at, updated_at
    `, [req.user.id, subjectId, sessionDate, startTime, duration, notes]);

    const session = result.rows[0];

    res.status(201).json({
      message: 'Study session created successfully',
      session: {
        id: session.id,
        sessionDate: session.session_date,
        startTime: session.start_time,
        duration: session.duration,
        notes: session.notes,
        createdAt: session.created_at,
        updatedAt: session.updated_at
      }
    });

  } catch (error) {
    console.error('Create study session error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update a study session
router.put('/:id', [
  authenticateToken,
  param('id').isUUID().withMessage('Invalid session ID'),
  body('subjectId').optional().isUUID().withMessage('Valid subject ID is required'),
  body('sessionDate').optional().isISO8601().withMessage('Valid session date is required'),
  body('startTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format required (HH:MM)'),
  body('duration').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer (minutes)'),
  body('notes').optional().isLength({ max: 1000 }).withMessage('Notes must be less than 1000 characters')
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
    const { subjectId, sessionDate, startTime, duration, notes } = req.body;

    // Check if session exists and belongs to user
    const existingSession = await query(
      'SELECT id FROM study_sessions WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingSession.rows.length === 0) {
      return res.status(404).json({ message: 'Study session not found' });
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

    if (subjectId !== undefined) {
      updates.push(`subject_id = $${paramCount++}`);
      values.push(subjectId);
    }
    if (sessionDate !== undefined) {
      updates.push(`session_date = $${paramCount++}`);
      values.push(sessionDate);
    }
    if (startTime !== undefined) {
      updates.push(`start_time = $${paramCount++}`);
      values.push(startTime);
    }
    if (duration !== undefined) {
      updates.push(`duration = $${paramCount++}`);
      values.push(duration);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id, req.user.id);
    const updateQuery = `
      UPDATE study_sessions
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount++} AND user_id = $${paramCount++}
      RETURNING id, session_date, start_time, duration, notes, created_at, updated_at
    `;

    const result = await query(updateQuery, values);
    const session = result.rows[0];

    res.json({
      message: 'Study session updated successfully',
      session: {
        id: session.id,
        sessionDate: session.session_date,
        startTime: session.start_time,
        duration: session.duration,
        notes: session.notes,
        createdAt: session.created_at,
        updatedAt: session.updated_at
      }
    });

  } catch (error) {
    console.error('Update study session error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete a study session
router.delete('/:id', [
  authenticateToken,
  param('id').isUUID().withMessage('Invalid session ID')
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

    // Check if session exists and belongs to user
    const existingSession = await query(
      'SELECT id FROM study_sessions WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingSession.rows.length === 0) {
      return res.status(404).json({ message: 'Study session not found' });
    }

    // Delete the session
    await query('DELETE FROM study_sessions WHERE id = $1 AND user_id = $2', [id, req.user.id]);

    res.json({ message: 'Study session deleted successfully' });

  } catch (error) {
    console.error('Delete study session error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;