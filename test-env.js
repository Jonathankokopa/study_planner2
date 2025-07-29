// Test environment variables loading
require('dotenv').config();

console.log('Testing environment variables...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET');

if (!process.env.NODE_ENV) {
  console.log('❌ .env file is not being loaded properly');
  console.log('Make sure .env file exists in the project root');
} else {
  console.log('✅ Environment variables loaded successfully');
}