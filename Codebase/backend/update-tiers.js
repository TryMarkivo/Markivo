const Database = require('better-sqlite3');
const db = new Database('./database/markivo.db');

const result = db.prepare('UPDATE users SET tier = ? WHERE tier = ?').run('pro', 'freemium');
console.log(`Updated ${result.changes} accounts from freemium to pro tier`);

const users = db.prepare('SELECT id, email, tier FROM users').all();
if(users.length > 0) {
  console.log('\nAll accounts:');
  users.forEach(u => console.log(`  ${u.email}: ${u.tier}`));
} else {
  console.log('No accounts in database');
}
db.close();
