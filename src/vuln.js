// CWE-89: SQL Injection
function getUser(db, userId) {
  return db.query('SELECT * FROM users WHERE id = ' + userId);
}

// CWE-79: Cross-site scripting
function renderComment(comment) {
  document.getElementById('output').innerHTML = comment;
}

// CWE-95: eval injection
function calculate(expr) {
  return eval(expr);
}
