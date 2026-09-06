// tests/harness.js — minimal async test harness.
export function createRunner() {
  let pass = 0;
  let fail = 0;
  const tests = [];
  return {
    test(name, fn) { tests.push({ name, fn }); },
    async run() {
      for (const t of tests) {
        try {
          await t.fn();
          pass += 1;
          console.log('  ok   - ' + t.name);
        } catch (e) {
          fail += 1;
          console.error('  FAIL - ' + t.name + ': ' + (e && e.message ? e.message : e));
        }
      }
      console.log('');
      console.log(pass + ' passed, ' + fail + ' failed');
      return fail === 0;
    },
  };
}

export function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function eq(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || 'eq') + ' expected ' + sb + ' got ' + sa);
}

export function approx(a, b, tol = 1e-6, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg || 'approx') + ' expected ' + b + ' got ' + a);
}
