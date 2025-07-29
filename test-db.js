// Test database connection
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'study_planner',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function testConnection() {
  console.log('Testing database connection...');
  console.log('Host:', process.env.DB_HOST);
  console.log('Database:', process.env.DB_NAME);
  console.log('User:', process.env.DB_USER);

  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful!');

    // Test a simple query
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Query test successful:', result.rows[0].current_time);

    client.release();
    process.exit(0);
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Suggestion: Make sure PostgreSQL is running');
      console.log('   Try: sudo service postgresql start');
    } else if (error.code === '28P01') {
      console.log('💡 Suggestion: Check your username/password in .env file');
    } else if (error.code === '3D000') {
      console.log('💡 Suggestion: Database does not exist. Create it with:');
      console.log('   createdb study_planner');
    }

    process.exit(1);
  }
}

testConnection();