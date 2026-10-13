import { createHash, createHmac, timingSafeEqual, randomInt } from 'node:crypto';
import { config } from './config.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const hmac = (s) => createHmac('sha256', config.secret).update(s).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

export function validCpf(input) {
  const c = onlyDigits(input);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(c[i]) * (n + 1 - i);
    const d = ((sum * 10) % 11) % 10;
    if (d !== Number(c[n])) return false;
  }
  return true;
}

export const maskCpf = (cpf) => {
  const c = onlyDigits(cpf);
  return `***.${c.slice(3, 6)}.***-**`;
};

export const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '')) && e.length <= 254;

export const validMac = (m) => /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(m || ''));
export const normMac = (m) => String(m || '').toLowerCase().replace(/-/g, ':');

export const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const nowIso = () => new Date().toISOString();
export const daysAgoIso = (d) => new Date(Date.now() - d * 86400_000).toISOString();

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function csvCell(v) {
  let s = v == null ? '' : String(v);
  // evita injeção de fórmula em planilhas
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows, cols) =>
  '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
