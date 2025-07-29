const express = require('express');
const { query: queryValidator, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get overall progress statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // Get overall task statistics
    const taskStats = await query(`
      SELECT
        COUNT(*) as total_tasks,
        COUNT(CASE WHEN completed = true THEN 1 END) as completed_tasks,
        COUNT(CASE WHEN completed = false THEN 1 END) as pending_tasks
      FROM tasks
      WHERE user_id = $1
    `, [req.user.id]);

    // Get total study time
    const studyTimeResult = await query(`
      SELECT COALESCE(SUM(duration), 0) as total_study_time
      FROM study_sessions
      WHERE user_id = $1
    `, [req.user.id]);

    // Get current streak (consecutive days with completed tasks)
    const streakResult = await query(`
      WITH daily_completions AS (
        SELECT
          DATE(completed_at) as completion_date,
          COUNT(*) as completed_count
        FROM tasks
        WHERE user_id = $1 AND completed = true AND completed_at IS NOT NULL
        GROUP BY DATE(completed_at)
        ORDER BY completion_date DESC
      ),
      streak_calculation AS (
        SELECT
          completion_date,
          ROW_NUMBER() OVER (ORDER BY completion_date DESC) as row_num,
          completion_date - INTERVAL '1 day' * (ROW_NUMBER() OVER (ORDER BY completion_date DESC) - 1) as expected_date
        FROM daily_completions
      )
      SELECT COUNT(*) as current_streak
      FROM streak_calculation
      WHERE completion_date = expected_date
    `, [req.user.id]);

    // Calculate productivity score (percentage of completed tasks)
    const stats = taskStats.rows[0];
    const totalTasks = parseInt(stats.total_tasks);
    const completedTasks = parseInt(stats.completed_tasks);
    const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    res.json({
      stats: {
        totalTasks,
        completedTasks,
        pendingTasks: parseInt(stats.pending_tasks),
        totalStudyTime: parseInt(studyTimeResult.rows[0].total_study_time),
        productivityScore,
        currentStreak: parseInt(streakResult.rows[0].current_streak)
      }
    });

  } catch (error) {
    console.error('Get progress stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get weekly progress data
router.get('/weekly', [
  authenticateToken,
  queryValidator('weeks').optional().isInt({ min: 1, max: 12 }).withMessage('Weeks must be between 1 and 12')
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

    const weeks = parseInt(req.query.weeks) || 4;

    // Get weekly task completion data
    const weeklyData = await query(`
      WITH week_series AS (
        SELECT
          date_trunc('week', CURRENT_DATE - INTERVAL '1 week' * generate_series(0, $2 - 1)) as week_start
      ),
      weekly_tasks AS (
        SELECT
          date_trunc('week', due_date) as week_start,
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN completed = true THEN 1 END) as completed_tasks
        FROM tasks
        WHERE user_id = $1
          AND due_date >= CURRENT_DATE - INTERVAL '1 week' * $2
        GROUP BY date_trunc('week', due_date)
      ),
      weekly_study_time AS (
        SELECT
          date_trunc('week', session_date) as week_start,
          SUM(duration) as study_time
        FROM study_sessions
        WHERE user_id = $1
          AND session_date >= CURRENT_DATE - INTERVAL '1 week' * $2
        GROUP BY date_trunc('week', session_date)
      )
      SELECT
        ws.week_start,
        COALESCE(wt.total_tasks, 0) as total_tasks,
        COALESCE(wt.completed_tasks, 0) as completed_tasks,
        COALESCE(wst.study_time, 0) as study_time
      FROM week_series ws
      LEFT JOIN weekly_tasks wt ON ws.week_start = wt.week_start
      LEFT JOIN weekly_study_time wst ON ws.week_start = wst.week_start
      ORDER BY ws.week_start DESC
    `, [req.user.id, weeks]);

    res.json({
      weeklyData: weeklyData.rows.map(week => ({
        weekStart: week.week_start,
        totalTasks: parseInt(week.total_tasks),
        completedTasks: parseInt(week.completed_tasks),
        studyTime: parseInt(week.study_time),
        completionRate: week.total_tasks > 0 ? Math.round((week.completed_tasks / week.total_tasks) * 100) : 0
      }))
    });

  } catch (error) {
    console.error('Get weekly progress error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get subject-wise progress data
router.get('/subjects', authenticateToken, async (req, res) => {
  try {
    // Get subject progress data
    const subjectProgress = await query(`
      SELECT
        s.id,
        s.name,
        s.color,
        COUNT(t.id) as total_tasks,
        COUNT(CASE WHEN t.completed = true THEN 1 END) as completed_tasks,
        COALESCE(SUM(ss.duration), 0) as total_study_time,
        COALESCE(AVG(t.estimated_time), 0) as avg_estimated_time
      FROM subjects s
      LEFT JOIN tasks t ON s.id = t.subject_id
      LEFT JOIN study_sessions ss ON s.id = ss.subject_id
      WHERE s.user_id = $1
      GROUP BY s.id, s.name, s.color
      ORDER BY s.name
    `, [req.user.id]);

    res.json({
      subjectProgress: subjectProgress.rows.map(subject => ({
        id: subject.id,
        name: subject.name,
        color: subject.color,
        totalTasks: parseInt(subject.total_tasks),
        completedTasks: parseInt(subject.completed_tasks),
        totalStudyTime: parseInt(subject.total_study_time),
        avgEstimatedTime: Math.round(parseFloat(subject.avg_estimated_time)),
        completionRate: subject.total_tasks > 0 ? Math.round((subject.completed_tasks / subject.total_tasks) * 100) : 0
      }))
    });

  } catch (error) {
    console.error('Get subject progress error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get daily progress for a specific date range
router.get('/daily', [
  authenticateToken,
  queryValidator('start_date').optional().isISO8601().withMessage('Valid start date required'),
  queryValidator('end_date').optional().isISO8601().withMessage('Valid end date required')
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

    const startDate = req.query.start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = req.query.end_date || new Date().toISOString().split('T')[0];

    // Get daily progress data
    const dailyProgress = await query(`
      WITH date_series AS (
        SELECT generate_series($2::date, $3::date, '1 day'::interval)::date as date
      ),
      daily_tasks AS (
        SELECT
          due_date,
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN completed = true THEN 1 END) as completed_tasks
        FROM tasks
        WHERE user_id = $1 AND due_date BETWEEN $2 AND $3
        GROUP BY due_date
      ),
      daily_study_time AS (
        SELECT
          session_date,
          SUM(duration) as study_time
        FROM study_sessions
        WHERE user_id = $1 AND session_date BETWEEN $2 AND $3
        GROUP BY session_date
      )
      SELECT
        ds.date,
        COALESCE(dt.total_tasks, 0) as total_tasks,
        COALESCE(dt.completed_tasks, 0) as completed_tasks,
        COALESCE(dst.study_time, 0) as study_time
      FROM date_series ds
      LEFT JOIN daily_tasks dt ON ds.date = dt.due_date
      LEFT JOIN daily_study_time dst ON ds.date = dst.session_date
      ORDER BY ds.date
    `, [req.user.id, startDate, endDate]);

    res.json({
      dailyProgress: dailyProgress.rows.map(day => ({
        date: day.date,
        totalTasks: parseInt(day.total_tasks),
        completedTasks: parseInt(day.completed_tasks),
        studyTime: parseInt(day.study_time),
        completionRate: day.total_tasks > 0 ? Math.round((day.completed_tasks / day.total_tasks) * 100) : 0
      }))
    });

  } catch (error) {
    console.error('Get daily progress error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;