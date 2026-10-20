import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { persistOnceWalletExists, WALLET_RECORD } from '../src/persist.ts';

function fakeStorage({ persisted = false, grant = true } = {}) {
  const calls = { persisted: 0, persist: 0 };
  return {
    calls,
    async persisted() {
      calls.persisted++;
      return persisted;
    },
    async persist() {
      calls.persist++;
      return grant;
    },
  };
}
const withWallet = async (key) => (key === WALLET_RECORD ? { [key]: { encrypted: true } } : {});
const noWallet = async () => ({});

test('the record checked is the one the wallet worker writes', () => {
  const background = readFileSync(new URL('../../extension/src/background.ts', import.meta.url), 'utf8');
  assert.match(background, new RegExp(`const WALLET_KEY = '${WALLET_RECORD}';`));
});

test('no wallet yet: persistence is not requested (no Firefox prompt for a visitor)', async () => {
  const s = fakeStorage();
  const keep = persistOnceWalletExists(s, noWallet);
  assert.equal(await keep(), false);
  assert.equal(s.calls.persist, 0);
});

test('a wallet exists: persistence is requested once per page load', async () => {
  const s = fakeStorage();
  const keep = persistOnceWalletExists(s, withWallet);
  assert.equal(await keep(), true);
  assert.equal(await keep(), false);
  assert.equal(s.calls.persist, 1);
});

test('the wallet appears after the first call: the next call asks', async () => {
  const s = fakeStorage();
  let created = false;
  const keep = persistOnceWalletExists(s, (k) => (created ? withWallet(k) : noWallet()));
  assert.equal(await keep(), false);
  created = true;
  assert.equal(await keep(), true);
  assert.equal(s.calls.persist, 1);
});

test('already persistent: no new request', async () => {
  const s = fakeStorage({ persisted: true });
  const keep = persistOnceWalletExists(s, withWallet);
  assert.equal(await keep(), true);
  assert.equal(s.calls.persist, 0);
});

test('a refused request is not repeated in the same page load', async () => {
  const s = fakeStorage({ grant: false });
  const keep = persistOnceWalletExists(s, withWallet);
  assert.equal(await keep(), false);
  assert.equal(await keep(), false);
  assert.equal(s.calls.persist, 1);
});

test('no StorageManager, or storage errors: nothing throws', async () => {
  assert.equal(await persistOnceWalletExists(undefined, withWallet)(), false);
  assert.equal(await persistOnceWalletExists({}, withWallet)(), false);
  const broken = { persisted: async () => { throw Error('SecurityError'); }, persist: async () => true };
  assert.equal(await persistOnceWalletExists(broken, withWallet)(), false);
  const unreadable = fakeStorage();
  assert.equal(await persistOnceWalletExists(unreadable, async () => { throw Error('blocked'); })(), false);
  assert.equal(unreadable.calls.persist, 0);
});
