#!/usr/bin/env node
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Client } = pkg;

async function main(){
  const username = process.argv[2];
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
    const r = await client.query('SELECT username, role FROM users WHERE username = $1 LIMIT 1', [username]);
    if(r.rowCount === 0){
      console.error('User not found:', username);
      process.exit(2);
    }
    console.log('Before:', r.rows[0]);
    await client.query("UPDATE users SET role = 'Admin' WHERE username = $1", [username]);
    const r2 = await client.query('SELECT username, role FROM users WHERE username = $1 LIMIT 1', [username]);
    console.log('After:', r2.rows[0]);
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
