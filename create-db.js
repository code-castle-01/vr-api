const mysql = require('mysql2/promise');

async function createDb() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: ''
    });
    await connection.query('CREATE DATABASE IF NOT EXISTS `vegas-rio`;');
    console.log('Database vegas-rio created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Failed to connect to MySQL:', error.message);
    process.exit(1);
  }
}

createDb();
