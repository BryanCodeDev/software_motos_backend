const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:4000');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const login = await request('POST', 'http://localhost:4000/api/auth/login', {
    email: 'admin@example.com',
    password: 'Admin1012@'
  });
  const token = JSON.parse(login.body).accessToken;

  // Probar con ID que sabemos existe (10)
  for (const testId of [10, 5, 1]) {
    const qr = await request('GET', `http://localhost:4000/api/admin/qrs/${testId}`, null, token);
    console.log(`GET /api/admin/qrs/${testId}:`, qr.status, qr.body.slice(0, 200));
  }

  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
