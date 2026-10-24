// Preserve the original sequential array iteration when a callback reads/writes
// the remote database. Promise.all would change ordering inside transactions.
async function mapAsync(values, callback) {
  const result = [];
  for (let i = 0; i < values.length; i++) result.push(await callback(values[i], i, values));
  return result;
}
async function filterAsync(values, callback) {
  const result = [];
  for (let i = 0; i < values.length; i++) if (await callback(values[i], i, values)) result.push(values[i]);
  return result;
}
async function forEachAsync(values, callback) {
  if (values instanceof Set) { for (const value of values) await callback(value, value, values); return; }
  for (let i = 0; i < values.length; i++) await callback(values[i], i, values);
}
async function findAsync(values, callback) {
  for (let i = 0; i < values.length; i++) if (await callback(values[i], i, values)) return values[i];
}
async function someAsync(values, callback) {
  for (let i = 0; i < values.length; i++) if (await callback(values[i], i, values)) return true;
  return false;
}
async function everyAsync(values, callback) {
  for (let i = 0; i < values.length; i++) if (!await callback(values[i], i, values)) return false;
  return true;
}
module.exports = { mapAsync, filterAsync, forEachAsync, findAsync, someAsync, everyAsync };
