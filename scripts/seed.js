const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'study_planner',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const seedData = async () => {
  const client = await pool.connect();

  try {
    console.log('Starting database seeding...');

    // Create test user
    const hashedPassword = await bcrypt.hash('testpassword123', 10);
    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `, ['test@example.com', hashedPassword, 'Test', 'User']);

    let userId;
    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
      console.log('✓ Test user created');
    } else {
      // Get existing user ID
      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', ['test@example.com']);
      userId = existingUser.rows[0].id;
      console.log('✓ Using existing test user');
    }

    // Create sample subjects
    const subjects = [
      { name: 'Mathematics', color: 'blue-500' },
      { name: 'Physics', color: 'red-500' },
      { name: 'Computer Science', color: 'purple-500' },
      { name: 'Literature', color: 'green-500' }
    ];

    const subjectIds = [];
    for (const subject of subjects) {
      const result = await client.query(`
        INSERT INTO subjects (user_id, name, color)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, name) DO UPDATE SET color = $3
        RETURNING id
      `, [userId, subject.name, subject.color]);
      subjectIds.push(result.rows[0].id);
    }
    console.log('✓ Sample subjects created');

    // Create sample tasks
    const tasks = [
      {
        title: 'Complete Calculus Assignment',
        description: 'Finish problems 1-20 from Chapter 5',
        due_date: '2024-01-15',
        due_time: '14:00',
        priority: 'high',
        estimated_time: 60,
        subject_index: 0 // Mathematics
      },
      {
        title: 'Read Physics Chapter 7',
        description: 'Focus on thermodynamics section',
        due_date: '2024-01-15',
        due_time: '16:00',
        priority: 'medium',
        estimated_time: 45,
        subject_index: 1 // Physics
      },
      {
        title: 'Study for CS Exam',
        description: 'Review algorithms and data structures',
        due_date: '2024-01-16',
        due_time: '10:00',
        priority: 'high',
        estimated_time: 120,
        subject_index: 2 // Computer Science
      },
      {
        title: 'Write Literature Essay',
        description: 'Analysis of Shakespeare\'s Hamlet',
        due_date: '2024-01-17',
        due_time: null,
        priority: 'medium',
        estimated_time: 90,
        subject_index: 3 // Literature
      }
    ];

    for (const task of tasks) {
      await client.query(`
        INSERT INTO tasks (user_id, subject_id, title, description, due_date, due_time, priority, estimated_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
      `, [
        userId,
        subjectIds[task.subject_index],
        task.title,
        task.description,
        task.due_date,
        task.due_time,
        task.priority,
        task.estimated_time
      ]);
    }
    console.log('✓ Sample tasks created');

    // Create sample study sessions
    const studySessions = [
      {
        session_date: '2024-01-14',
        start_time: '09:00',
        duration: 60,
        notes: 'Focus on integration techniques',
        subject_index: 0 // Mathematics
      },
      {
        session_date: '2024-01-14',
        start_time: '14:00',
        duration: 90,
        notes: 'Review quantum mechanics',
        subject_index: 1 // Physics
      },
      {
        session_date: '2024-01-15',
        start_time: '10:00',
        duration: 45,
        notes: 'Algorithm practice problems',
        subject_index: 2 // Computer Science
      }
    ];

    for (const session of studySessions) {
      await client.query(`
        INSERT INTO study_sessions (user_id, subject_id, session_date, start_time, duration, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [
        userId,
        subjectIds[session.subject_index],
        session.session_date,
        session.start_time,
        session.duration,
        session.notes
      ]);
    }
    console.log('✓ Sample study sessions created');

    // Create sample progress logs
    const progressLogs = [
      { date: '2024-01-14', tasks_completed: 3, total_tasks: 5, study_time: 150, productivity_score: 85 },
      { date: '2024-01-13', tasks_completed: 2, total_tasks: 4, study_time: 120, productivity_score: 75 },
      { date: '2024-01-12', tasks_completed: 4, total_tasks: 4, study_time: 180, productivity_score: 95 }
    ];

    for (const log of progressLogs) {
      await client.query(`
        INSERT INTO progress_logs (user_id, date, tasks_completed, total_tasks, study_time, productivity_score)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, date) DO UPDATE SET
          tasks_completed = $3,
          total_tasks = $4,
          study_time = $5,
          productivity_score = $6
      `, [userId, log.date, log.tasks_completed, log.total_tasks, log.study_time, log.productivity_score]);
    }
    console.log('✓ Sample progress logs created');

    console.log('✅ Database seeding completed successfully!');
    console.log('Test user credentials: test@example.com / testpassword123');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

const runSeeding = async () => {
  try {
    await seedData();
    console.log('Seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
};

// Run seeding if this file is executed directly
if (require.main === module) {
  runSeeding();
}

module.exports = { seedData };