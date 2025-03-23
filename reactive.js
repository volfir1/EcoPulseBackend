// reactivation-test.js - Run this with Node.js to test the reactivation endpoint
const axios = require('axios');

// Replace with your actual API URL and token
const API_URL = 'http://localhost:5000/api/auth';
const TOKEN = '871b85c55c70d34c0f75d56e4f151e659b17b04f4e2959658c856f651f7ab51c';

async function testReactivation() {
  try {
    console.log('Testing reactivation with token:', TOKEN.substring(0, 10) + '...');
    
    const response = await axios.post(`${API_URL}/reactivate-account`, {
      token: TOKEN
    });
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('Reactivation failed:', error.response ? error.response.data : error.message);
  }
}

testReactivation();