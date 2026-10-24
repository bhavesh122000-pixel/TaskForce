const crypto = require('node:crypto');

function createStorage({ env = process.env, fetcher = fetch } = {}) {
  const url = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'taskforce-files';
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(url) || !key || key.startsWith('sb_publishable_')) throw new Error('Set SUPABASE_URL and the server-only SUPABASE_SECRET_KEY in .env.local.');
  const headers = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const object = name => `${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;
  async function request(route, { method = 'GET', body, bytes, allow404 = false } = {}) {
    const response = await fetcher(url + '/storage/v1' + route, {
      method, headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(bytes ? { 'Content-Type': bytes.type || 'application/octet-stream' } : {}) },
      body: bytes ? bytes.data : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (allow404 && (response.status === 404 || response.status === 400)) return null;
    if (!response.ok) throw Object.assign(new Error(`Supabase file storage request failed (${response.status}).`), { status: 502 });
    return response;
  }
  return {
    bucket,
    async ensureBucket() {
      const response = await request(`/bucket/${encodeURIComponent(bucket)}`, { allow404: true });
      if (response) {
        const info = await response.json();
        if (info.public) throw new Error('SUPABASE_STORAGE_BUCKET must be a private bucket.');
      } else await request('/bucket', { method: 'POST', body: { id: bucket, name: bucket, public: false } });
    },
    async put(name, data, type = 'application/octet-stream') { await request(`/object/${object(name)}`, { method: 'POST', bytes: { data, type } }); return name; },
    async get(name) { return Buffer.from(await (await request(`/object/authenticated/${object(name)}`)).arrayBuffer()); },
    async size(name) {
      const response = await request(`/object/authenticated/${object(name)}`, { method: 'HEAD' });
      const value = response.headers.get('content-length'); return value == null ? -1 : Number(value);
    },
    async remove(names) { if (names.length) await request(`/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', body: { prefixes: names } }); },
    async copy(source, destination) { await request('/object/copy', { method: 'POST', body: { bucketId: bucket, sourceKey: source, destinationKey: destination } }); },
    async list(prefix = '') {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await (await request(`/object/list/${encodeURIComponent(bucket)}`, { method: 'POST', body: { prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } } })).json();
        rows.push(...page);
        if (page.length < 1000) return rows;
      }
    },
    async signedUpload(name) {
      const result = await (await request(`/object/upload/sign/${object(name)}`, { method: 'POST', body: {} })).json();
      return url + '/storage/v1' + result.url;
    },
    async signedDownload(name, filename, inline = false) {
      const result = await (await request(`/object/sign/${object(name)}`, { method: 'POST', body: { expiresIn: 60 } })).json();
      const signed = new URL(url + '/storage/v1' + (result.signedURL || result.signedUrl));
      if (!inline) signed.searchParams.set('download', filename);
      return signed.toString();
    },
    randomName: filename => crypto.randomBytes(16).toString('hex') + (require('node:path').extname(filename || '').slice(0, 12).replace(/[^.\w]/g, '')),
  };
}
module.exports = { createStorage };
