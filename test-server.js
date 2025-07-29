// Simple test to verify server can start without dependencies
const express = require('express');

console.log('Testing basic Express server...');

const app = express();
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

const PORT = 3001;
const server = app.listen(PORT, () => {
  console.log(`✓ Test server running on port ${PORT}`);
  console.log('✓ Express is working correctly');
  server.close(() => {
    console.log('✓ Test completed successfully');
    process.exit(0);
  });
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});