// Crypto: watch-only wallet addresses (BTC, ETH, LTC, DOGE, SOL) and manual coin holdings,
// valued with CoinGecko prices. No exchange logins or private keys are ever needed.
const { db } = require('../db');
const { encrypt, decrypt } = require('../security');
const { upsertAccount } = require('../engine/ingest');

const COINS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', LTC: 'litecoin', DOGE: 'dogecoin', ADA: 'cardano', XRP: 'ripple',
  USDC: 'usd-coin', USDT: 'tether', AVAX: 'avalanche-2', DOT: 'polkadot', LINK: 'chainlink', MATIC: 'matic-network',
  SHIB: 'shiba-inu', BCH: 'bitcoin-cash', XLM: 'stellar', ATOM: 'cosmos', TRX: 'tron', BNB: 'binancecoin',
};

async function prices(ids) {
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${[...new Set(ids)].join(',')}&vs_currencies=usd`);
  if (!res.ok) throw new Error(`Price lookup failed (${res.status})`);
  return res.json();
}

async function onchainBalance(chain, address) {
  if (chain === 'BTC' || chain === 'LTC') {
    const host = chain === 'BTC' ? 'https://mempool.space/api' : 'https://litecoinspace.org/api';
    const r = await (await fetch(`${host}/address/${encodeURIComponent(address)}`)).json();
    const s = r.chain_stats, m = r.mempool_stats;
    return (s.funded_txo_sum - s.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum) / 1e8;
  }
  if (chain === 'ETH') {
    const r = await (await fetch('https://ethereum-rpc.publicnode.com', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    })).json();
    if (r.error) throw new Error(r.error.message);
    return Number(BigInt(r.result)) / 1e18;
  }
  if (chain === 'SOL') {
    const r = await (await fetch('https://solana-rpc.publicnode.com', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
    })).json();
    if (r.error) throw new Error(r.error.message);
    return r.result.value / 1e9;
  }
  if (chain === 'DOGE') {
    const r = await (await fetch(`https://api.blockcypher.com/v1/doge/main/addrs/${encodeURIComponent(address)}/balance`)).json();
    return (r.final_balance || 0) / 1e8;
  }
  throw new Error(`Wallet lookups are not supported for ${chain}; add it as a manual holding instead.`);
}

/** holding: {symbol, address?} or {symbol, quantity} ; optional name, coingecko_id */
async function add(h) {
  const symbol = String(h.symbol || '').toUpperCase().trim();
  const id = h.coingecko_id || COINS[symbol];
  if (!id) throw new Error(`Unknown coin ${symbol}. Enter its CoinGecko id.`);
  const name = h.name || (h.address ? `${symbol} wallet ${String(h.address).slice(0, 6)}…` : `${symbol} holdings`);
  const info = db.prepare('INSERT INTO connections(provider,name,institution,secret_enc,created,status) VALUES(?,?,?,?,?,?)')
    .run('crypto', name, 'Crypto', encrypt({ symbol, coingecko_id: id, address: h.address || null, quantity: h.address ? null : Number(h.quantity) || 0 }), Date.now(), 'ok');
  const cid = Number(info.lastInsertRowid);
  await sync(cid);
  return cid;
}

async function sync(connectionId) {
  const conn = db.prepare('SELECT * FROM connections WHERE id=?').get(connectionId);
  const h = decrypt(conn.secret_enc);
  const qty = h.address ? await onchainBalance(h.symbol, h.address) : h.quantity;
  const p = (await prices([h.coingecko_id]))[h.coingecko_id];
  const price = p ? p.usd : 0;
  upsertAccount(connectionId, {
    external_id: 'holding', name: conn.name, type: 'crypto', subtype: h.symbol, balance: Math.round(qty * price * 100) / 100,
    institution: 'Crypto', meta: { symbol: h.symbol, quantity: qty, price, address: h.address },
  });
  return { quantity: qty, price };
}

module.exports = { add, sync, COINS };
