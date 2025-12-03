#!/usr/bin/env node
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Client } = pkg;

async function main(){
  const username = process.argv[2];
  // optional duration in minutes (temporary admin). If omitted, default to 60 minutes.
  const minutes = process.argv[3] ? parseInt(process.argv[3], 10) : 60;
  const databaseUrl = process.env.DATABASE_URL;
  if(!username){
    console.error('Usage: node promoteAdmin.js <username>');
    process.exit(1);
  }
  if(!databaseUrl){
    console.error('DATABASE_URL not set. Set it or run from Render shell where it's available.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try{
    await client.connect();
    const r = await client.query('SELECT username, role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
    if(r.rowCount === 0){
      console.error('User not found:', username);
      process.exit(2);
    }
    console.log('Before:', r.rows[0]);
    if(Number.isInteger(minutes) && minutes > 0){
      const expires = new Date(Date.now() + minutes * 60000);
      await client.query('UPDATE users SET admin_expires = $1 WHERE username = $2', [expires, username]);
      const r2 = await client.query('SELECT username, role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
      console.log('After (temporary admin):', r2.rows[0]);
      console.log(`Admin access granted for ${minutes} minute(s) until ${expires.toISOString()}`);
    }else{
      await client.query("UPDATE users SET role = 'Admin', admin_expires = NULL WHERE username = $1", [username]);
      const r2 = await client.query('SELECT username, role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
      console.log('After (permanent admin):', r2.rows[0]);
    }
    await client.end();
    console.log('Promotion complete');
    process.exit(0);
  }catch(err){
    console.error('Error promoting user:', err);
    try{ await client.end(); }catch(e){}
    process.exit(1);
  }
}

main();
