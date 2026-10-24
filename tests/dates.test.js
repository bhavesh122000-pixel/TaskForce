const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dateMath } = require('../core/dates');

test('deadline calculations preserve calendar offsets, holidays, weekends and missing dates', () => {
  const math = dateMath(new Set(['2027-01-26','2027-01-25']));
  const matter = { created_at:'2027-01-01 10:00:00', settlement_date:'2027-01-29', finance_date:null };
  assert.equal(math.dueFrom('settlement',-3,matter),'2027-01-22');
  assert.equal(math.dueFrom('settlement',-6,matter),'2027-01-22');
  assert.equal(math.dueFrom('opened',22,matter),'2027-01-27');
  assert.equal(math.dueFrom('finance',5,matter),null);
  assert.equal(math.dueFrom('settlement',0,matter),'2027-01-29');
  assert.equal(math.dueFrom('unknown',1,matter),null);
  assert.equal(math.businessDay('2028-02-29',1),'2028-02-29');
  assert.equal(math.stageDue({from:'opened',days:0},matter),'2027-01-01');
});
