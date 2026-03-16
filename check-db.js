const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  try {
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: 'admin',
      database: 'vegas-rio'
    });
    
    console.log('--- DATABASE CHECK ---');
    const [users] = await conn.execute('SELECT id, username, email FROM up_users');
    console.log(`Found ${users.length} users.`);
    users.forEach(u => console.log(`- ${u.username} (${u.email})`));
    
    const [roles] = await conn.execute('SELECT * FROM up_roles');
    console.log('\n--- ROLES ---');
    roles.forEach(r => console.log(`- ID: ${r.id}, Name: ${r.name}, Type: ${r.type}`));
    
    await conn.end();
  } catch (err) {
    console.error('Database Error:', err.message);
  }
}

run();
