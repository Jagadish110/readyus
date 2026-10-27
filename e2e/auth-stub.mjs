// A stand-in for Supabase Auth so the browser tests can sign in without a real project.
// Any token containing a known name below counts as that person. Never run this anywhere real.
import http from 'node:http';

export const USERS = {
  'tok-customer': { id: '11111111-1111-4111-8111-111111111111', email: 'asha@example.test' },
  'tok-admin': { id: '55555555-5555-4555-8555-555555555555', email: 'admin@example.test' },
  'tok-owner': { id: 'ec258de3-b60b-4883-a7db-8d49c252f66a', email: 'paradise@readyus.test' }
};

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    const key = Object.keys(USERS).find((k) => token.includes(k));
    if (req.url?.startsWith('/auth/v1/user') && key) {
      return res.end(
        JSON.stringify({ ...USERS[key], aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
      );
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ message: 'invalid' }));
  })
  .listen(54321, () => console.log('auth stub on 54321'));
