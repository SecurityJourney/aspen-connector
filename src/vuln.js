const express = require('express');
const { Client } = require('pg');

const app = express();
const db = new Client();

// CWE-89: SQL injection — user input concatenated directly into query
app.get('/user', async (req, res) => {
  const id = req.query.id;
  const result = await db.query('SELECT * FROM users WHERE id = ' + id);
  res.json(result.rows);
});

// CWE-79: XSS — user input written to DOM without sanitization
app.get('/comment', (req, res) => {
  const comment = req.query.comment;
  res.send(`<div id="output"></div><script>document.getElementById('output').innerHTML = '${comment}'</script>`);
});

// CWE-95: eval injection — user input evaluated as code
app.get('/calc', (req, res) => {
  const expr = req.query.expr;
  const result = eval(expr);
  res.json({ result });
});

app.listen(3000);
