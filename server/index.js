// Tiny dependency-free REST API over the SQLite store.
//   GET    /api/health
//   GET    /api/trees            -> [{ id, name }]
//   POST   /api/trees            (TreeData) -> { id }
//   GET    /api/trees/:id        -> TreeData
//   PUT    /api/trees/:id        (TreeData) -> { ok: true }
//   DELETE /api/trees/:id        -> { ok: true }
//
// Run: npm run server   (node --experimental-sqlite server/index.js)

import http from 'node:http';
import {
  listTrees,
  getTree,
  saveTree,
  deleteTree,
  newTreeId,
} from './db.js';

const PORT = Number(process.env.PORT) || 3001;
const MAX_BODY = 64 * 1024 * 1024; // 64 MB (photos are inlined as data URLs)

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/'); // ['api','trees',':id']

    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (parts[0] !== 'api') return send(res, 404, { error: 'not found' });

    if (parts[1] === 'health') return send(res, 200, { ok: true });

    if (parts[1] === 'trees') {
      const id = parts[2] && decodeURIComponent(parts[2]);

      if (!id && req.method === 'GET') return send(res, 200, listTrees());

      if (!id && req.method === 'POST') {
        const data = await readBody(req);
        if (!data || !data.persons || !data.unions) {
          return send(res, 400, { error: 'expected a tree { persons, unions }' });
        }
        const newId = newTreeId();
        saveTree(newId, data);
        return send(res, 201, { id: newId });
      }

      if (id && req.method === 'GET') {
        const tree = getTree(id);
        return tree ? send(res, 200, tree) : send(res, 404, { error: 'tree not found' });
      }

      if (id && req.method === 'PUT') {
        const data = await readBody(req);
        if (!data || !data.persons || !data.unions) {
          return send(res, 400, { error: 'expected a tree { persons, unions }' });
        }
        saveTree(id, data);
        return send(res, 200, { ok: true });
      }

      if (id && req.method === 'DELETE') {
        deleteTree(id);
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('API error:', e);
    return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`🌳 family-tree DB API on http://localhost:${PORT}  (SQLite: node:sqlite)`);
});
