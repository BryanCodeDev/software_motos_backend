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
  // Primero autenticarse como admin
  const login = await request('POST', 'http://localhost:4000/api/auth/login', {
    email: 'admin@example.com',
    password: 'Admin1012@'
  });
  console.log('LOGIN:', login.status);
  const token = JSON.parse(login.body).accessToken;

  // Probar listado de QRs
  const qrs = await request('GET', 'http://localhost:4000/api/admin/qrs?page=1&limit=25', null, token);
  console.log('GET /api/admin/qrs:', qrs.status);
  const data = JSON.parse(qrs.body);
  console.log('Total QRs:', data.pagination?.total, 'Páginas:', data.pagination?.pages);
  if (data.qrs && data.qrs.length > 0) {
    console.log('Primer QR ID:', data.qrs[0].id, 'Valor:', data.qrs[0].value);
    
    // Probar detalle de ese QR
    const qr = await request('GET', `http://localhost:4000/api/admin/qrs/${data.qrs[0].id}`, null, token);
    console.log(`GET /api/admin/qrs/${data.qrs[0].id}:`, qr.status, qr.body.slice(0, 200));
  }

  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
