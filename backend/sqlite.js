// The local-office option remains available explicitly with TF_BACKEND=sqlite.
// The mutex keeps remote-await scheduling from interleaving SQLite transactions.
function wrapSqlite(db) {
  let tail = Promise.resolve();
  return {
    dialect: 'sqlite',
    prepare: sql => db.prepare(sql),
    exec: sql => db.exec(sql),
    close: () => db.close(),
    async withConnection(callback) {
      let release;
      const previous = tail;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      try { return await callback(); } finally { release(); }
    },
  };
}
module.exports = { wrapSqlite };
