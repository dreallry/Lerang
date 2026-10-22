import type { TbBarang, TbLelang, HistoryLelang, TbMasyarakat, TbPetugas, AuctionDetailItem } from '../types';

function positiveID(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID data dari server tidak valid.');
  return id;
}

function amount(value: unknown): number {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result) || result < 0) throw new Error('Nilai data dari server tidak valid.');
  return result;
}

export function normalizeBarang(data: Record<string, unknown>): TbBarang {
  const id = positiveID(data.id_barang);
  const price = amount(data.harga_awal);
  return {
    ...data,
    id_barang: id,
    id_user: data.id_user ? positiveID(data.id_user) : null,
    harga_awal: price,
    nama_barang: String(data.nama_barang || ''),
    deskripsi_barang: String(data.deskripsi_barang || ''),
    kategori: String(data.kategori || 'Lainnya') as TbBarang['kategori'],
    tanggal: String(data.tanggal || data.created_at || ''),
    status_verifikasi: String(data.status_verifikasi || 'approved') as TbBarang['status_verifikasi'],
    foto_barang: Array.isArray(data.foto_barang) ? data.foto_barang.filter((url): url is string => typeof url === 'string') : [],
    dokumen_pendukung: Array.isArray(data.dokumen_pendukung) ? data.dokumen_pendukung.filter((url): url is string => typeof url === 'string') : [],
    reserve_price: data.reserve_price ? amount(data.reserve_price) : undefined,
  } as TbBarang;
}

export function itemRevision(item: Pick<TbBarang, 'updated_at' | 'created_at' | 'tanggal'>): string {
  return item.updated_at || item.created_at || item.tanggal || '';
}

export function documentLinkError(value: string, existing: string[]): string {
  if (existing.length >= 12) return 'Maksimal 12 tautan dokumen per barang.';
  try {
    const url = new URL(value);
    if (value.length > 4096 || !/^https?:\/\//i.test(value) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
  } catch {
    return 'Masukkan tautan dokumen HTTP atau HTTPS, bukan nama dokumen.';
  }
  return existing.includes(value) ? 'Tautan dokumen ini sudah ditambahkan.' : '';
}

export function normalizeLelang(value: Record<string, unknown>): TbLelang {
  const data = value.lelang && typeof value.lelang === 'object' ? value.lelang as Record<string, unknown> : value;
  return {
    ...data,
    id_lelang: positiveID(data.id_lelang),
    id_barang: positiveID(data.id_barang),
    id_sesi: data.id_sesi ? positiveID(data.id_sesi) : undefined,
    id_petugas: data.id_petugas ? positiveID(data.id_petugas) : 0,
    id_user: data.id_user ? positiveID(data.id_user) : null,
    tgl_mulai: String(data.tgl_mulai || ''),
    tgl_selesai: String(data.tgl_selesai || ''),
    harga_akhir: amount(data.harga_akhir),
    minimum_bid: data.minimum_bid !== undefined ? amount(data.minimum_bid) : undefined,
    bid_increment: data.bid_increment !== undefined ? amount(data.bid_increment) : undefined,
    kelipatan_minimal: amount(data.kelipatan_minimal),
    uang_jaminan: amount(data.uang_jaminan),
    reserve_price: data.reserve_price ? amount(data.reserve_price) : undefined,
    status: String(data.status || 'terjadwal') as TbLelang['status'],
    is_reserve_met: data.is_reserve_met === true,
  } as TbLelang;
}

export function normalizeHistory(data: Record<string, unknown>, auctions: TbLelang[]): HistoryLelang {
  const auctionID = positiveID(data.id_lelang);
  const itemID = data.id_barang || auctions.find(auction => auction.id_lelang === auctionID)?.id_barang;
  return {
    ...data,
    id_history: String(data.id_history),
    id_lelang: auctionID,
    id_barang: positiveID(itemID),
    id_user: positiveID(data.id_user),
    nama_user: String(data.nama_user || 'Peserta'),
    penawaran_harga: amount(data.penawaran_harga),
    created_at: String(data.created_at || ''),
  } as HistoryLelang;
}

export function mergeBarang(first: TbBarang[], latest: TbBarang[]): TbBarang[] {
  return [...new Map([...first, ...latest].map(item => [item.id_barang, item])).values()];
}

export function joinAuctions(
  auctions: readonly TbLelang[],
  items: readonly TbBarang[],
  bids: readonly HistoryLelang[],
  users: readonly TbMasyarakat[],
  officers: readonly TbPetugas[]
): AuctionDetailItem[] {
  const itemsByID = new Map(items.map(item => [item.id_barang, item]));
  const usersByID = new Map(users.map(user => [user.id_user, user]));
  const officersByID = new Map(officers.map(officer => [officer.id_petugas, officer]));
  const bidsByAuction = new Map<number, HistoryLelang[]>();
  for (const bid of bids) {
    const history = bidsByAuction.get(bid.id_lelang);
    if (history) history.push(bid);
    else bidsByAuction.set(bid.id_lelang, [bid]);
  }
  for (const history of bidsByAuction.values()) history.sort((a, b) => b.penawaran_harga - a.penawaran_harga);

  const joined: AuctionDetailItem[] = [];
  for (const lelang of auctions) {
    const barang = itemsByID.get(lelang.id_barang);
    if (!barang) continue;
    const history = bidsByAuction.get(lelang.id_lelang) || [];
    const winnerName = history.find(bid => bid.id_user === lelang.id_user)?.nama_user;
    const penawarTertinggi = usersByID.get(lelang.id_user ?? 0)
      || (lelang.id_user && winnerName ? { id_user: lelang.id_user, nama_lengkap: winnerName } : null);
    joined.push({
      lelang, barang, history, totalBids: history.length, penawarTertinggi,
      petugas: officersByID.get(lelang.id_petugas) || null,
      penjual: usersByID.get(barang.id_user ?? 0) || null,
    });
  }
  return joined;
}
