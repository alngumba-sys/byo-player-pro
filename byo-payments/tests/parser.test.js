const { parseTelebirrReceipt } = require('../api/telebirr-parser');
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } }

console.log('== The real sample SMS ==');
const real = `Dear Lewam
You have received ETB 21,000.00 from ALBERT NGUMBA(2519****7421) on 03/10/2026 17:10:11. Your transaction number is DJ35DTF97H. Your current E-Money Account balance is ETB 21,767.95.
Thank you for using telebirr
Ethio telecom`;
const r = parseTelebirrReceipt(real);
check('parses ok', r.ok === true);
check('amount whole = 21000', r.amount === 21000);
check('amountExact = 21000', r.amountExact === 21000);
check('payerName = ALBERT NGUMBA', r.payerName === 'ALBERT NGUMBA');
check('payerLast4 = 7421', r.payerLast4 === '7421');
check('txnId = DJ35DTF97H', r.txnId === 'DJ35DTF97H');
check('paidAt EAT iso', r.paidAt === '2026-10-03T17:10:11+03:00');
check('balanceAfter = 21767.95', r.balanceAfter === 21767.95);

console.log('== Small test amount (ETB 5.00) ==');
const five = parseTelebirrReceipt(
  'Dear Hulet You have received ETB 5.00 from TEST USER(251913****8610) on 05/10/2026 15:30:00. Your transaction number is AB12CD34EF. Your current E-Money Account balance is ETB 105.00. Thank you for using telebirr');
check('ok', five.ok);
check('amount = 5', five.amount === 5);
check('last4 = 8610', five.payerLast4 === '8610');
check('txn = AB12CD34EF', five.txnId === 'AB12CD34EF');

console.log('== Underpay partial (ETB 4) ==');
const four = parseTelebirrReceipt(
  'You have received ETB 4.00 from X Y(251911****8610) on 05/10/2026 15:31:00. Your transaction number is PART00001. Your current E-Money Account balance is ETB 109.00.');
check('ok', four.ok && four.amount === 4 && four.payerLast4 === '8610');

console.log('== REJECTS: outgoing payment (not a receipt) ==');
const sent = parseTelebirrReceipt(
  'You have transferred ETB 50.00 to SOMEONE(251911****1111). Your transaction number is OUT00001.');
check('rejected', sent.ok === false && /not an incoming/.test(sent.reason));

console.log('== REJECTS: OTP / promo junk ==');
check('otp rejected', parseTelebirrReceipt('Your telebirr OTP is 123456').ok === false);
check('promo rejected', parseTelebirrReceipt('Get 10% off with telebirr today!').ok === false);
check('empty rejected', parseTelebirrReceipt('').ok === false);

console.log('== REJECTS: missing txn id ==');
check('no-txn rejected', parseTelebirrReceipt(
  'You have received ETB 5.00 from A B(251911****8610) on 05/10/2026 15:30:00.').ok === false);

console.log('== Handles comma amounts & name with spaces ==');
const big = parseTelebirrReceipt(
  'You have received ETB 1,234,567.89 from JOHN PAUL JONES(251911****4321) on 01/01/2026 09:00:00. Your transaction number is BIG00001. Your current E-Money Account balance is ETB 2,000,000.00.');
check('big amount whole', big.amount === 1234567);
check('name 3 words', big.payerName === 'JOHN PAUL JONES');
check('last4 4321', big.payerLast4 === '4321');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
