const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB = path.join(DATA, 'site.json');
const sessions = new Map();
const limits = new Map();
fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({ admin: null, posts: [], likes: {} }, null, 2));
const readDb = () => { const db = JSON.parse(fs.readFileSync(DB, 'utf8')); if (!Array.isArray(db.categories)) db.categories = []; return db; };
const writeDb = db => fs.writeFileSync(DB, JSON.stringify(db, null, 2));
const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'untitled';
const send = (res, status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(data)); };
const body = req => new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Please send valid JSON.')); } }); req.on('error', reject); });
const tokenFrom = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const isAdmin = req => sessions.has(tokenFrom(req));
const ipKey = req => { const forwarded=req.headers['x-forwarded-for'];const address=(typeof forwarded==='string'&&forwarded.split(',')[0].trim())||req.socket.remoteAddress||'local';return crypto.createHash('sha256').update(address).digest('hex'); };
const limited = (req, key, max = 8) => { const id = `${ipKey(req)}:${key}`, now = Date.now(), hits = (limits.get(id) || []).filter(t => now - t < 60_000); if (hits.length >= max) return true; hits.push(now); limits.set(id, hits); return false; };
const published = db => db.posts.filter(p => p.status === 'published').sort((a,b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
const clean = x => typeof x === 'string' ? x.trim() : '';

async function api(req, res, url) {
  const db = readDb();
  if (req.method === 'GET' && url.pathname === '/api/site') return send(res, 200, { setup: !db.admin, categories: db.categories, posts: published(db).map(({ id,title,slug,excerpt,content,publishedAt,updatedAt,comments,categories,pinned }) => ({ id,title,slug,excerpt,content,publishedAt,updatedAt,categories: categories || [],pinned: !!pinned,comments: comments.length,likes: db.likes[id]?.count || 0 })) });
  if (req.method === 'GET' && url.pathname.startsWith('/api/posts/')) { const post = published(db).find(p => p.slug === url.pathname.slice(11)); return post ? send(res, 200, { ...post, likes: db.likes[post.id]?.count || 0 }) : send(res, 404, { error: 'Article not found.' }); }
  if (req.method === 'POST' && url.pathname === '/api/setup') {
    if (limited(req, 'setup', 5)) return send(res, 429, { error: 'Too many setup attempts. Wait a minute and try again.' });
    const b = await body(req); if (db.admin) return send(res, 409, { error: 'The writing desk is already set up.' });
    const setupKey = process.env.ADMIN_SETUP_KEY || ''; const suppliedKey = clean(b.setupKey);
    if (setupKey.length < 32) return send(res, 503, { error: 'Owner setup is locked. Set ADMIN_SETUP_KEY to a secret with at least 32 characters in the backend environment.' });
    const keyA=Buffer.from(setupKey),keyB=Buffer.from(suppliedKey); if (keyA.length !== keyB.length || !crypto.timingSafeEqual(keyA,keyB)) return send(res, 401, { error: 'The setup key did not match.' });
    const password = clean(b.password); if (password.length < 12) return send(res, 400, { error: 'Choose a password with at least 12 characters.' });
    const salt = crypto.randomBytes(16).toString('hex'); db.admin = { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; writeDb(db);
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, true); return send(res, 200, { ok: true, token });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    if (limited(req, 'login', 5)) return send(res, 429, { error: 'Too many password attempts. Wait a minute and try again.' });
    const b = await body(req); if (!db.admin) return send(res, 400, { error: 'Set up the writing desk first.' });
    const hash = crypto.scryptSync(clean(b.password), db.admin.salt, 64).toString('hex'); if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(db.admin.hash))) return send(res, 401, { error: 'That password did not match.' });
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, true); return send(res, 200, { ok: true, token });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') { sessions.delete(tokenFrom(req)); return send(res, 200, { ok:true }); }
  if (req.method === 'DELETE' && url.pathname === '/api/admin/comments') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Please sign in to your writing desk.' });
    const id=url.searchParams.get('id');const post=db.posts.find(p=>(p.comments||[]).some(c=>c.id===id));if(!post)return send(res,404,{error:'Comment not found.'});post.comments=post.comments.filter(c=>c.id!==id);writeDb(db);return send(res,200,{ok:true});
  }
  if (url.pathname === '/api/admin/categories') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Please sign in to your writing desk.' });
    if (req.method === 'POST') { const name=clean((await body(req)).name).slice(0,48); if(!name)return send(res,400,{error:'Enter a category name.'}); if(db.categories.some(c=>c.name.toLowerCase()===name.toLowerCase()))return send(res,409,{error:'That category already exists.'});const category={id:crypto.randomUUID(),name};db.categories.push(category);writeDb(db);return send(res,201,category); }
    if (req.method === 'DELETE') { const id=url.searchParams.get('id');db.categories=db.categories.filter(c=>c.id!==id);for(const post of db.posts)post.categories=(post.categories||[]).filter(x=>x!==id);writeDb(db);return send(res,200,{ok:true}); }
  }
  if (url.pathname === '/api/admin') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Please sign in to your writing desk.' });
    if (req.method === 'GET') return send(res, 200, { posts: db.posts.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(p=>({...p,likes:db.likes[p.id]?.count||0})), categories: db.categories, setup: false });
    if (req.method === 'POST') {
      const b = await body(req), title = clean(b.title), content = clean(b.content); if (!title || !content) return send(res, 400, { error: 'Add a title and some writing before saving.' });
      const now = new Date().toISOString(), id = b.id || crypto.randomUUID(); let post = db.posts.find(p => p.id === id);
      const slugBase = slugify(clean(b.slug) || title); let slug = slugBase, n = 2; while (db.posts.some(p => p.slug === slug && p.id !== id)) slug = `${slugBase}-${n++}`;
      if (!post) { post = { id, comments: [], createdAt: now, publishedAt: null }; db.posts.push(post); }
      const categoryIds=Array.isArray(b.categories)?[...new Set(b.categories.filter(id=>db.categories.some(c=>c.id===id)))]:post.categories||[];
      Object.assign(post, { title, slug, excerpt: clean(b.excerpt).slice(0, 260), content, categories:categoryIds, pinned:!!b.pinned, status: b.status === 'published' ? 'published' : 'draft', updatedAt: now }); if (post.status === 'published' && !post.publishedAt) post.publishedAt = now; writeDb(db); return send(res, 200, post);
    }
    if (req.method === 'DELETE') { const id = url.searchParams.get('id'); db.posts = db.posts.filter(p => p.id !== id); delete db.likes[id]; writeDb(db); return send(res, 200, { ok:true }); }
  }
  const match = url.pathname.match(/^\/api\/posts\/([^/]+)\/(comments|like)$/);
  if (match && req.method === 'POST') {
    const post = published(db).find(p => p.slug === match[1]); if (!post) return send(res, 404, { error: 'Article not found.' });
    if (limited(req, match[2], match[2] === 'like' ? 40 : 5)) return send(res, 429, { error: 'Please wait a little before trying again.' });
    const b = await body(req), who = ipKey(req);
    if (match[2] === 'like') { const likes = db.likes[post.id] || (db.likes[post.id] = { count: 0, voters: [] }); if (!likes.voters.includes(who)) { likes.voters.push(who); likes.count++; writeDb(db); } return send(res, 200, { likes: likes.count }); }
    const name = clean(b.name).slice(0, 48), text = clean(b.text).slice(0, 1200); if (!name || !text) return send(res, 400, { error: 'Add your name and a comment first.' });
    const comment = { id: crypto.randomUUID(), name, text, createdAt: new Date().toISOString() }; post.comments.push(comment); writeDb(db); return send(res, 201, comment);
  }
  return send(res, 404, { error: 'Not found.' });
}

const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml' };
const LOCAL_FRONTEND = path.resolve(ROOT, '..', 'frontend');
http.createServer(async (req,res) => { try { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const origin=req.headers.origin; const allowed=(process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',').map(x=>x.trim()); if(origin && allowed.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');} if(req.method==='OPTIONS'){res.writeHead(204);return res.end();} if (url.pathname.startsWith('/api/')) return await api(req,res,url); if(fs.existsSync(LOCAL_FRONTEND)){const requested=decodeURIComponent(url.pathname);const target=path.resolve(LOCAL_FRONTEND, `.${requested === '/' ? '/index.html' : requested}`);if(!target.startsWith(LOCAL_FRONTEND+path.sep)&&target!==LOCAL_FRONTEND)return send(res,400,{error:'Bad path.'});const file=fs.existsSync(target)&&fs.statSync(target).isFile()?target:path.join(LOCAL_FRONTEND,'index.html');res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).pipe(res);} return send(res,404,{error:'API only.'}); } catch (e) { if (!res.headersSent) send(res,500,{error:e.message || 'Something went wrong.'}); } }).listen(PORT, '0.0.0.0', () => console.log(`Writing desk API is ready on port ${PORT}`));
