import type { TbMasyarakat, TbPetugas } from '../types';

type SessionProfile = { kind: 'masyarakat'; profile: TbMasyarakat } | { kind: 'petugas'; profile: TbPetugas };

export function parseSessionProfile(value: unknown): SessionProfile {
  if (!value || typeof value !== 'object') throw new Error('Profil akun dari server tidak valid.');
  const data = value as Record<string, unknown>;
  if (data.id_petugas !== undefined) {
    const id = Number(data.id_petugas);
    const level = Number(data.id_level);
    if (!Number.isSafeInteger(id) || id <= 0 || ![1, 2].includes(level)) throw new Error('Profil petugas belum memiliki hak akses yang valid.');
    return { kind: 'petugas', profile: { ...data, id_petugas: id, id_level: level } as unknown as TbPetugas };
  }
  const id = Number(data.id_user);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Profil peserta dari server tidak valid.');
  const wallet = Number(data.saldo_wallet ?? 0);
  const held = Number(data.saldo_hold ?? 0);
  if (!Number.isFinite(wallet) || wallet < 0 || !Number.isFinite(held) || held < 0) throw new Error('Saldo dari server tidak valid. Muat ulang akun Anda.');
  return { kind: 'masyarakat', profile: { ...data, id_user: id, saldo_wallet: wallet, saldo_hold: held } as unknown as TbMasyarakat };
}
