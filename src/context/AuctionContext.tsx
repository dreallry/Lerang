import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { TbMasyarakat, TbPetugas, TbBarang, TbLelang, TbTheme, TbSesiLelang, SesiType, HistoryLelang, TbPembayaran, WalletTransaction, NotificationItem, UserRole, CategoryType, AuctionDetailItem, FulfillmentOrder, FulfillmentStatus } from '../types';
import api, { ApiError, type SnapPaymentResponse, type CourierOption } from '../services/api';
import { auth } from '../firebase';
import { parseSessionProfile } from '../utils/sessionProfile';
import { mergeBarang, normalizeBarang, normalizeLelang, normalizeHistory } from '../utils/catalogData';
import { normalizeInvoice, normalizeFulfillment, normalizeNotification, normalizeWallet } from '../utils/accountData';
import { authErrorMessage } from '../utils/authErrors';
import type { SessionStatus } from '../utils/authFlow';
import { startPolling } from '../utils/polling';

type ActionResult = { success: boolean; message: string; id_sesi?: number; updated_at?: string };

type PaymentConfirmation = { type: 'topup' | 'payment'; orderId: string };

interface AuctionContextType {
  // Roles & Auth
  currentRole: UserRole;
  currentUser: TbMasyarakat | null;
  currentOfficer: TbPetugas | null;
  sessionStatus: SessionStatus;
  sessionRevision: number;
  setPollingView: (view: string) => void;
  reloadSession: () => void;
  logout: () => Promise<void>;

  // Data collections
  masyarakatList: TbMasyarakat[];
  petugasList: TbPetugas[];
  barangList: TbBarang[];
  lelangList: TbLelang[];
  themesList: TbTheme[];
  selectedThemeId: number | null;
  setSelectedThemeId: (id: number | null) => void;
  sesiLelangList: TbSesiLelang[];
  createSession: (data: {
    judul: string;
    deskripsi: string;
    tipe: SesiType;
    tgl_mulai: string;
    durasi_default_jam: number;
    gambar_banner: string;
    kurator?: string;
    id_lelang_list?: number[];
  }) => Promise<ActionResult>;
  assignToSession: (
    lelangId: number,
    sesiId: number,
    customDurationHours?: number
  ) => Promise<ActionResult>;
  removeFromSession: (lelangId: number) => Promise<ActionResult>;
  cancelSession: (sesiId: number) => Promise<ActionResult>;
  historyList: HistoryLelang[];
  pembayaranList: TbPembayaran[];
  transactionsList: WalletTransaction[];
  notificationsList: NotificationItem[];

  // Joined Helper
  getAuctionDetail: (lelangId: number) => AuctionDetailItem | null;
  activeAuctions: AuctionDetailItem[];
  allJoinedAuctions: AuctionDetailItem[];
  catalogStatus: 'loading' | 'ready' | 'error';
  reloadCatalog: () => void;
  accountDataStatus: 'idle' | 'loading' | 'ready' | 'error';
  accountUpdatedAt: string | null;
  reloadAccountData: () => void;

  // User Actions
  hasDepositLocked: (lelangId: number, userId?: number) => boolean;
  lockDepositForAuction: (lelangId: number) => Promise<ActionResult>;
  placeBid: (lelangId: number, customAmount?: number) => Promise<ActionResult>;
  topUpDeposit: (amount: number, requestId: string) => Promise<SnapPaymentResponse>;
  submitC2CItem: (data: {
    nama_barang: string;
    harga_awal: number;
    kategori: CategoryType;
    deskripsi_barang: string;
    foto_barang: string[];
    dokumen_pendukung: string[];
    spesifikasi?: Record<string, string>;
    reserve_price?: number;
  }) => Promise<{ success: boolean; message: string }>;
  cancelC2CSubmission: (barangId: number) => Promise<{ success: boolean; message: string }>;
  payInvoice: (pembayaranId: number) => Promise<SnapPaymentResponse>;
  refreshFinancialData: (confirmation?: PaymentConfirmation) => Promise<boolean>;
  withdrawFunds: (
    amount: number,
    bankName: string,
    accountNumber: string,
    accountHolder: string,
    requestID: string
  ) => Promise<{ success: boolean; message: string }>;
  resubmitC2CItem: (
    barangId: number,
    data: {
      expected_updated_at: string;
      nama_barang: string;
      harga_awal: number;
      kategori: CategoryType;
      deskripsi_barang: string;
      foto_barang: string[];
      dokumen_pendukung: string[];
      spesifikasi?: Record<string, string>;
      reserve_price?: number;
    }
  ) => Promise<{ success: boolean; message: string }>;

  // Officer / Admin Actions
  approveC2CListing: (
    barangId: number,
    config: {
      expected_updated_at: string;
      kelipatan_minimal: number;
      uang_jaminan: number;
      reserve_price?: number;
      tgl_mulai?: string;
      tgl_selesai?: string;
    }
  ) => Promise<ActionResult>;
  updateBarangInfo: (
    barangId: number,
    data: Partial<Pick<TbBarang, 'nama_barang' | 'deskripsi_barang' | 'harga_awal' | 'kategori' | 'reserve_price'>> & { expected_updated_at: string }
  ) => Promise<ActionResult>;
  rejectC2CListing: (barangId: number, reason: string, expectedUpdatedAt: string) => Promise<ActionResult>;
  createOfficerAuction: (
    barangData: Omit<TbBarang, 'id_barang' | 'tanggal' | 'status_verifikasi'>,
    lelangData: {
      tgl_mulai: string;
      tgl_selesai: string;
      kelipatan_minimal: number;
      uang_jaminan: number;
    }
  ) => Promise<ActionResult>;
  updateAuctionStatus: (lelangId: number, status: 'dibuka' | 'ditutup' | 'dibatalkan') => Promise<ActionResult>;

  // Auto-Bid (Proxy Bidding)
  autoBids: Record<string, number>;
  setupAutoBid: (lelangId: number, maxAmount: number) => Promise<ActionResult>;
  cancelAutoBid: (lelangId: number) => Promise<ActionResult>;
  getUserAutoBid: (lelangId: number, userId?: number) => number | null;

  // Notifications
  markNotificationAsRead: (notifId: string) => Promise<ActionResult>;
  unreadNotifsCount: number;

  // Active Midtrans Modal State
  midtransModal: {
    isOpen: boolean;
    type: 'topup' | 'payment';
    amount: number;
    title: string;
    refId?: string;
    onSuccess?: () => void;
  } | null;
  openMidtransModal: (config: {
    type: 'topup' | 'payment';
    amount: number;
    title: string;
    refId?: string;
    onSuccess?: () => void;
  }) => void;
  closeMidtransModal: () => void;

  courierOptions: CourierOption[];

  // Fulfillment & Ekspedisi
  fulfillmentList: FulfillmentOrder[];
  recordShippingPayment: (id: string, data: { reference: string; amount: number; courier: string; service: string; expected_updated_at: string }) => Promise<ActionResult>;
  getFulfillmentByInvoice: (invoiceId: number) => FulfillmentOrder | undefined;
  updateFulfillmentAddress: (
    fulfillmentId: string,
    addressData: {
      expected_updated_at: string;
      nama_penerima: string;
      telp_penerima: string;
      alamat_lengkap: string;
      kota: string;
      kode_pos: string;
    }
  ) => Promise<ActionResult>;
  updateFulfillmentCourier: (
    fulfillmentId: string,
    courierData: {
      expected_updated_at: string;
      kurir: string;
      layanan_kurir: string;
      ongkir: number;
    }
  ) => Promise<ActionResult>;
  updateFulfillmentTracking: (
    fulfillmentId: string,
    nomorResi: string,
    status: FulfillmentStatus,
    description: string | undefined,
    expectedUpdatedAt: string
  ) => Promise<ActionResult>;
  confirmFulfillmentReceived: (
    fulfillmentId: string,
    rating: number,
    ulasan: string
  ) => Promise<ActionResult>;
  aturJadwalHarian: (tanggal: string, jam: string, catatan?: string) => Promise<any>;
  aturDurasiKategori: (kategori: string, durasi: number) => Promise<any>;
  bukaLelangSerentakHariIni: () => Promise<any>;
}

const AuctionContext = createContext<AuctionContextType | undefined>(undefined);

export const AuctionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [masyarakatList, setMasyarakatList] = useState<TbMasyarakat[]>([]);
  const [petugasList, setPetugasList] = useState<TbPetugas[]>([]);
  const [publicItems, setPublicItems] = useState<TbBarang[]>([]);
  const [privateItems, setPrivateItems] = useState<TbBarang[]>([]);
  const [publicAuctionRows, setPublicAuctionRows] = useState<TbLelang[]>([]);
  const [staffAuctionRows, setStaffAuctionRows] = useState<TbLelang[]>([]);
  const barangList = useMemo(() => mergeBarang(publicItems, privateItems), [publicItems, privateItems]);
  const lelangList = useMemo(() => [...new Map([...publicAuctionRows, ...staffAuctionRows].map(auction => [auction.id_lelang, auction])).values()], [publicAuctionRows, staffAuctionRows]);
  const [themesList, setThemesList] = useState<TbTheme[]>([]);
  const [sesiLelangList, setSesiLelangList] = useState<TbSesiLelang[]>([]);
  const [historyList, setHistoryList] = useState<HistoryLelang[]>([]);
  const [pembayaranList, setPembayaranList] = useState<TbPembayaran[]>([]);
  const [transactionsList, setTransactionsList] = useState<WalletTransaction[]>([]);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
  const [fulfillmentList, setFulfillmentList] = useState<FulfillmentOrder[]>([]);
  const [courierOptions, setCourierOptions] = useState<CourierOption[]>([]);
  const [heldDeposits, setHeldDeposits] = useState<Record<string, boolean>>({});
  const [autoBids, setAutoBids] = useState<Record<string, number>>({});
  const [currentRole, setCurrentRole] = useState<UserRole>('masyarakat');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentOfficerId, setCurrentOfficerId] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [pollingView, setPollingView] = useState(() => window.location.hash.slice(1).split('?')[0]);
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [accountDataStatus, setAccountDataStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [accountUpdatedAt, setAccountUpdatedAt] = useState<string | null>(null);
  const [midtransModal, setMidtransModal] = useState<AuctionContextType['midtransModal']>(null);
  const catalogRequest = useRef(0);
  const accountRequest = useRef(0);
  const walletRequest = useRef(0);
  const sessionVersion = useRef(0);
  const pendingMutations = useRef(new Set<string>());

  const currentUser = useMemo(() => masyarakatList.find(user => user.id_user === currentUserId) || null, [masyarakatList, currentUserId]);
  const currentOfficer = useMemo(() => petugasList.find(officer => officer.id_petugas === currentOfficerId) || null, [petugasList, currentOfficerId]);

  const clearSession = useCallback(() => {
    sessionVersion.current++;
    accountRequest.current++; walletRequest.current++;
    setCurrentUserId(null); setCurrentOfficerId(0); setCurrentRole('masyarakat'); setMasyarakatList([]); setPetugasList([]);
    setPembayaranList([]); setTransactionsList([]); setNotificationsList([]); setFulfillmentList([]); setHeldDeposits({}); setAutoBids({}); setCourierOptions([]); setMidtransModal(null);
    setPrivateItems([]); setStaffAuctionRows([]); setAccountDataStatus('idle'); setAccountUpdatedAt(null); setSessionStatus('guest');
    for (const key of ['lelang_masyarakat_v1', 'lelang_petugas_v1', 'lelang_barang_v1', 'lelang_lelang_v1', 'lelang_themes_v1', 'lelang_sessions_v1', 'lelang_history_v1', 'lelang_pembayaran_v1', 'lelang_transactions_v1', 'lelang_notifs_v1', 'lelang_held_deposits_v1', 'lelang_autobids_v1', 'lelang_fulfillment_v1']) {
      try { localStorage.removeItem(key); } catch { /* Session cleanup does not depend on browser storage. */ }
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    const request = ++catalogRequest.current;
    try {
      const responses = await Promise.all([api.getCatalog(), api.getAuctions(), api.getSessions(), api.getThemes(), api.getAllHistory()]);
      if (!responses.every(response => Array.isArray(response?.data))) throw new Error('Respons katalog tidak valid.');
      const [items, auctions, sessions, themes, history] = responses;
      const remoteAuctions = auctions.data.map(normalizeLelang) as TbLelang[];
      const remoteItems = items.data.map(normalizeBarang) as TbBarang[];
      const remoteHistory = history.data.map((bid: Record<string, unknown>) => normalizeHistory(bid, remoteAuctions));
      const remoteSessions = sessions.data.map((session: TbSesiLelang) => ({
        ...session,
        id_sesi: Number(session.id_sesi),
        durasi_default_jam: Number(session.durasi_default_jam),
        id_lelang_list: Array.isArray(session.id_lelang_list) ? session.id_lelang_list.map(Number) : [],
      }));
      const remoteThemes = themes.data.map((theme: TbTheme) => ({ ...theme, id_theme: Number(theme.id_theme), id_lelang_list: Array.isArray(theme.id_lelang_list) ? theme.id_lelang_list.map(Number) : [] }));
      if (request !== catalogRequest.current) return;
      setPublicItems(remoteItems);
      setPublicAuctionRows(remoteAuctions);
      setSesiLelangList(remoteSessions);
      setThemesList(remoteThemes);
      setHistoryList(remoteHistory);
      setCatalogStatus('ready');
    } catch (error) {
      if (request === catalogRequest.current) setCatalogStatus('error');
      throw error;
    }
  }, []);

  const refreshFinancialData = useCallback(async (confirmation?: PaymentConfirmation): Promise<boolean> => {
    const owner = auth.currentUser;
    if (!owner || !currentUserId) return false;
    const request = ++walletRequest.current;
    const [invoiceResponse, walletResponse] = await Promise.all([api.getInvoices(), api.getWalletInfo()]);
    if (!Array.isArray(invoiceResponse?.data)) throw new Error('Respons tagihan tidak valid.');
    const invoices = invoiceResponse.data.map(normalizeInvoice);
    const wallet = normalizeWallet(walletResponse?.data, currentUserId);
    if (auth.currentUser !== owner || request !== walletRequest.current) return false;
    setPembayaranList(invoices);
    setTransactionsList(wallet.transactions);
    setHeldDeposits(wallet.heldDeposits);
    setAutoBids(wallet.autoBids);
    setMasyarakatList(previous => previous.map(user => user.id_user === currentUserId ? { ...user, saldo_wallet: wallet.saldo_wallet, saldo_hold: wallet.saldo_hold, financial_review_required:wallet.financial_review_required } : user));
    if (!confirmation) return true;
    return confirmation.type === 'payment'
      ? invoices.some(invoice => invoice.order_id === confirmation.orderId && invoice.status === 'Sudah Dibayar')
      : wallet.transactions.some(transaction => transaction.referensi_id === confirmation.orderId && transaction.status === 'sukses');
  }, [currentUserId]);

  const loadAccount = useCallback(async () => {
    const owner = auth.currentUser;
    if (!owner || (!currentUserId && !currentOfficerId)) return;
    const request = ++accountRequest.current;
    const staff = currentRole !== 'masyarakat';
    try {
      const [items, notifications, fulfillments, invoices, users, auctions, couriers, officers] = await Promise.all([
        staff ? api.getAllItems() : api.getMyItems(), api.getNotifications(), api.getFulfillments(),
        staff ? api.getInvoices() : refreshFinancialData().then(() => null),
        currentRole === 'administrator' ? api.getUsers() : Promise.resolve(null), staff ? api.getAllAuctions() : Promise.resolve(null), api.getCouriers(),
        currentRole === 'administrator' ? api.getStaff() : Promise.resolve(null),
      ]);
      for (const response of [items, notifications, fulfillments, invoices, users, auctions, couriers, officers]) {
        if (response !== null && !Array.isArray(response?.data)) throw new Error('Respons data akun tidak valid.');
      }
      const privateItems = items.data.map(normalizeBarang);
      const remoteFulfillment = fulfillments.data.map(normalizeFulfillment);
      const remoteNotifications = notifications.data.map(normalizeNotification);
      const remoteInvoices = invoices?.data.map(normalizeInvoice);
      const remoteUsers = users?.data.map((user: unknown) => {
        const session = parseSessionProfile(user);
        if (session.kind !== 'masyarakat') throw new Error('Daftar peserta tidak valid.');
        return session.profile;
      });
      const remoteAuctions = auctions?.data.map(normalizeLelang);
      const remoteOfficers = officers?.data.map((officer: unknown) => {
        const session = parseSessionProfile(officer);
        if (session.kind !== 'petugas') throw new Error('Daftar petugas tidak valid.');
        return session.profile;
      });
      if (auth.currentUser !== owner || request !== accountRequest.current) return;
      setPrivateItems(privateItems);
      if (remoteAuctions) setStaffAuctionRows(remoteAuctions);
      if (remoteInvoices) setPembayaranList(remoteInvoices);
      if (remoteUsers) setMasyarakatList(remoteUsers);
      if (remoteOfficers) setPetugasList(remoteOfficers);
      setFulfillmentList(remoteFulfillment);
      setNotificationsList(remoteNotifications);
      setCourierOptions(couriers.data);
      setAccountUpdatedAt(new Date().toISOString());
      setAccountDataStatus('ready');
    } catch (error) {
      if (auth.currentUser === owner && request === accountRequest.current) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          clearSession();
          setSessionStatus('error');
        } else setAccountDataStatus('error');
      }
      throw error;
    }
  }, [currentRole, currentUserId, currentOfficerId, refreshFinancialData, clearSession]);

  const reloadCatalog = useCallback(() => { setCatalogStatus('loading'); void loadCatalog().catch(() => {}); }, [loadCatalog]);
  const reloadAccountData = useCallback(() => { setAccountDataStatus('loading'); void loadAccount().catch(() => {}); }, [loadAccount]);
  const catalogPollDelay = pollingView === 'auction-detail' ? 5000 : 30000;
  const accountPollDelay = ['auction-detail', 'wallet', 'invoices', 'fulfillment'].includes(pollingView) ? 10000 : 30000;

  useEffect(() => {
    const stop = startPolling(loadCatalog, catalogPollDelay);
    return () => { stop(); catalogRequest.current++; };
  }, [loadCatalog, catalogPollDelay]);

  useEffect(() => {
    if (!currentUserId && !currentOfficerId) { setAccountDataStatus('idle'); return; }
    setAccountDataStatus('loading');
    const stop = startPolling(loadAccount, accountPollDelay);
    return () => { stop(); accountRequest.current++; walletRequest.current++; };
  }, [loadAccount, currentUserId, currentOfficerId, accountPollDelay]);

  const setMasyarakatSession = useCallback((profile: TbMasyarakat) => {
    setPrivateItems([]); setStaffAuctionRows([]); setHeldDeposits({}); setAutoBids({}); setPembayaranList([]); setTransactionsList([]); setFulfillmentList([]); setNotificationsList([]);
    setMasyarakatList([profile]); setCurrentUserId(profile.id_user); setCurrentOfficerId(0); setCurrentRole('masyarakat'); api.setToken(null);
  }, []);
  const setPetugasSession = useCallback((profile: TbPetugas) => {
    setPrivateItems([]); setStaffAuctionRows([]); setHeldDeposits({}); setAutoBids({}); setPembayaranList([]); setTransactionsList([]); setFulfillmentList([]); setNotificationsList([]);
    setPetugasList([profile]); setCurrentOfficerId(profile.id_petugas); setCurrentUserId(null); setCurrentRole(profile.id_level === 1 ? 'administrator' : 'petugas'); api.setToken(null);
  }, []);
  const logout = useCallback(async () => { await signOut(auth); api.setToken(null); clearSession(); }, [clearSession]);
  const reloadSession = useCallback(() => setSessionAttempt(attempt => attempt + 1), []);

  useEffect(() => {
    let active = true;
    let event = 0;
    const unsubscribe = onAuthStateChanged(auth, firebaseUser => {
      const currentEvent = ++event;
      clearSession();
      if (!firebaseUser) { api.setToken(null); clearSession(); return; }
      setSessionStatus('loading');
      void api.me().then(response => {
        if (!active || currentEvent !== event) return;
        const session = parseSessionProfile(response.data);
        if (session.kind === 'petugas') setPetugasSession(session.profile); else setMasyarakatSession(session.profile);
        setSessionStatus('authenticated');
      }).catch(error => {
        if (!active || currentEvent !== event) return;
        clearSession();
        const missingProfile = error instanceof ApiError && error.status === 403 && /belum memiliki profil/i.test(error.message);
        setSessionStatus(missingProfile ? 'profile-required' : 'error');
      });
    });
    return () => { active = false; unsubscribe(); };
  }, [setMasyarakatSession, setPetugasSession, clearSession, sessionAttempt]);

  const getAuctionDetail = useCallback((lelangId: number): AuctionDetailItem | null => {
    const lelang = lelangList.find(auction => auction.id_lelang === lelangId);
    if (!lelang) return null;
    const barang = barangList.find(item => item.id_barang === lelang.id_barang);
    if (!barang) return null;
    const history = historyList.filter(bid => bid.id_lelang === lelangId).sort((a, b) => b.penawaran_harga - a.penawaran_harga);
    const winnerID = lelang.id_user;
    const winnerName = history.find(bid => bid.id_user === winnerID)?.nama_user;
    const penawarTertinggi = masyarakatList.find(user => user.id_user === winnerID) || (winnerID && winnerName ? { id_user: winnerID, nama_lengkap: winnerName } as TbMasyarakat : null);
    return { lelang, barang, history, totalBids: history.length, penawarTertinggi, petugas: petugasList.find(officer => officer.id_petugas === lelang.id_petugas) || null, penjual: masyarakatList.find(user => user.id_user === barang.id_user) || null };
  }, [barangList, lelangList, historyList, masyarakatList, petugasList]);
  const allJoinedAuctions = useMemo(() => lelangList.map(auction => getAuctionDetail(auction.id_lelang)).filter((item): item is AuctionDetailItem => item !== null), [lelangList, getAuctionDetail]);
  const activeAuctions = useMemo(() => allJoinedAuctions.filter(item => item.lelang.status === 'dibuka'), [allJoinedAuctions]);
  const hasDepositLocked = useCallback((lelangId: number, userId?: number) => !!heldDeposits[`${lelangId}_${userId || currentUserId}`], [heldDeposits, currentUserId]);
  const getUserAutoBid = (lelangId: number, userId?: number) => autoBids[`${lelangId}_${userId || currentUserId}`] || null;

  const commit = async (key: string, operation: () => Promise<any>, message: string): Promise<ActionResult> => {
    const owner = auth.currentUser;
    if (!owner) return { success: false, message: 'Silakan masuk terlebih dahulu.' };
    const mutationKey = `${sessionVersion.current}:${owner.uid}:${key}`;
    if (pendingMutations.current.has(mutationKey)) return { success: false, message: 'Permintaan yang sama masih diproses.' };
    pendingMutations.current.add(mutationKey);
    try {
      const response = await operation();
      if (!response?.success) throw new Error(response?.message || 'Server belum mengonfirmasi penyimpanan.');
      if (auth.currentUser !== owner) return { success: false, message: 'Sesi akun berubah. Periksa hasil permintaan melalui akun yang mengirimkannya.' };
      const refreshed = await Promise.allSettled([loadCatalog(), loadAccount()]);
      const stale = refreshed.some(result => result.status === 'rejected');
      return { success: true, message: `${response.message || message}${stale ? ' Data tersimpan, tetapi tampilan belum diperbarui. Muat ulang halaman untuk memeriksa hasilnya.' : ''}`, id_sesi: response.data?.id_sesi, updated_at: response.data?.updated_at };
    } catch (error) {
      return { success: false, message: authErrorMessage(error) };
    } finally { pendingMutations.current.delete(mutationKey); }
  };

  const lockDepositForAuction = (id: number) => commit(`deposit:${id}`, () => api.lockDeposit(id), 'Jaminan telah dikunci oleh server.');
  const placeBid = (id: number, amount?: number) => {
    const auction = lelangList.find(auction => auction.id_lelang === id);
    if (!auction) return Promise.resolve({ success: false, message: 'Lot tidak ditemukan.' });
    return commit(`bid:${id}`, () => api.placeBid(id, amount ?? auction.minimum_bid ?? auction.harga_akhir + auction.kelipatan_minimal), 'Penawaran tersimpan.');
  };
  const setupAutoBid = (id: number, amount: number) => commit(`autobid:${id}`, () => api.setupAutoBid(id, amount), 'Batas penawaran otomatis tersimpan di server.');
  const cancelAutoBid = (id: number) => commit(`autobid:${id}`, () => api.cancelAutoBid(id), 'Penawaran otomatis dinonaktifkan.');
  const topUpDeposit = (amount: number, requestId: string) => api.createSnapPayment({ tipe_pembayaran: 'topup', jumlah_tagihan: amount, request_id: requestId });
  const payInvoice = (id: number) => api.createSnapPayment({ id_pembayaran: id, tipe_pembayaran: 'pelunasan' });
  const withdrawFunds: AuctionContextType['withdrawFunds'] = (amount, bank, account, holder, requestID) => commit('withdraw', () => api.withdrawFunds({ amount, bank_name: bank, account_number: account, account_holder: holder, request_id:requestID }), 'Permintaan penarikan tersimpan untuk diproses petugas.');
  const submitC2CItem: AuctionContextType['submitC2CItem'] = data => commit('submit-item', () => api.submitBarang(data), 'Pengajuan tersimpan dan menunggu pemeriksaan.');
  const resubmitC2CItem: AuctionContextType['resubmitC2CItem'] = (id, data) => commit(`item:${id}`, () => api.updateBarang(id, data), 'Perbaikan tersimpan dan menunggu pemeriksaan ulang.');
  const cancelC2CSubmission = (id: number) => commit(`item:${id}`, () => api.cancelSubmission(id), 'Pengajuan dibatalkan.');
  const approveC2CListing: AuctionContextType['approveC2CListing'] = (id, config) => commit(`curation:${id}`, () => api.validasiBarang(id, { status: 'approved', catatan_kurasi: 'Disetujui kurator.', ...config }), 'Pengajuan disetujui dan lot masuk ke Lot Pool.');
  const rejectC2CListing: AuctionContextType['rejectC2CListing'] = (id, reason, expectedUpdatedAt) => commit(`curation:${id}`, () => api.validasiBarang(id, { status: 'rejected', catatan_kurasi: reason, expected_updated_at: expectedUpdatedAt }), 'Pengajuan ditolak.');
  const updateBarangInfo: AuctionContextType['updateBarangInfo'] = (id, data) => commit(`item:${id}`, () => api.updateBarang(id, data), 'Perubahan barang tersimpan.');
  const createOfficerAuction: AuctionContextType['createOfficerAuction'] = (item, auction) => commit('create-official', () => api.createOfficerAuction(item, auction), 'Lot resmi dibuat.');
  const updateAuctionStatus: AuctionContextType['updateAuctionStatus'] = (id, status) => commit(`auction-status:${id}`, () => api.updateAuctionStatus(id, status), 'Status lelang tersimpan.');
  const createSession: AuctionContextType['createSession'] = data => commit('create-session', () => api.createSession(data), 'Sesi tersimpan.');
  const assignToSession: AuctionContextType['assignToSession'] = (id, session, duration) => commit(`session-lot:${id}`, () => api.assignToSession(id, session, duration), 'Lot dijadwalkan.');
  const removeFromSession = (id: number) => {
    const lot = lelangList.find(auction => auction.id_lelang === id);
    if (!lot?.id_sesi) return Promise.resolve({ success: false, message: 'Lot belum terhubung ke sesi.' });
    return commit(`session-lot:${id}`, () => api.removeFromSession(id, lot.id_sesi!), 'Lot dikembalikan ke Lot Pool.');
  };
  const cancelSession = (id: number) => commit(`session:${id}`, () => api.cancelSession(id), 'Sesi dibatalkan.');
  const getFulfillmentByInvoice = (id: number) => fulfillmentList.find(order => order.id_pembayaran === id);
  const updateFulfillmentAddress: AuctionContextType['updateFulfillmentAddress'] = (id, address) => commit(`fulfillment:${id}`, () => api.updateFulfillmentAddress(id, address), 'Alamat tersimpan.');
  const updateFulfillmentCourier: AuctionContextType['updateFulfillmentCourier'] = (id, courier) => commit(`fulfillment:${id}`, () => api.updateFulfillmentCourier(id, courier), 'Layanan pengiriman tersimpan.');
  const updateFulfillmentTracking: AuctionContextType['updateFulfillmentTracking'] = (id, resi, status, description, expectedUpdatedAt) => commit(`fulfillment:${id}`, () => api.updateFulfillmentResi(id, resi, status, description, expectedUpdatedAt), 'Status pengiriman tersimpan.');
  const recordShippingPayment: AuctionContextType['recordShippingPayment'] = (id, data) => commit(`fulfillment:${id}`, () => api.recordShippingPayment(id, data), 'Bukti ongkir tercatat. Saldo dan tagihan lelang tidak diubah.');
  const confirmFulfillmentReceived = (id: string, rating: number, review: string) => commit(`fulfillment:${id}`, () => api.selesaikanOrder(id, rating, review), 'Penerimaan pesanan dan ulasan tersimpan.');
  const markNotificationAsRead = (id: string) => commit(`notification:${id}`, () => api.markNotifikasiRead(id), 'Notifikasi ditandai dibaca.');
  const unreadNotifsCount = notificationsList.filter(notification => !notification.dibaca).length;
  const openMidtransModal: AuctionContextType['openMidtransModal'] = config => setMidtransModal({ isOpen: true, ...config });
  const closeMidtransModal = () => setMidtransModal(null);

  const value: AuctionContextType = {
    currentRole, currentUser, currentOfficer, sessionStatus, sessionRevision: sessionVersion.current, setPollingView, reloadSession, logout,
    masyarakatList, petugasList, barangList, lelangList, themesList, selectedThemeId, setSelectedThemeId, sesiLelangList,
    historyList, pembayaranList, transactionsList, notificationsList, getAuctionDetail, allJoinedAuctions, activeAuctions,
    catalogStatus, reloadCatalog, accountDataStatus, accountUpdatedAt, reloadAccountData,
    hasDepositLocked, lockDepositForAuction, placeBid, topUpDeposit, submitC2CItem, resubmitC2CItem, cancelC2CSubmission, payInvoice, refreshFinancialData, withdrawFunds,
    approveC2CListing, updateBarangInfo, rejectC2CListing, createOfficerAuction, updateAuctionStatus, createSession, assignToSession, removeFromSession, cancelSession,
    autoBids, setupAutoBid, cancelAutoBid, getUserAutoBid, markNotificationAsRead, unreadNotifsCount,
    midtransModal, openMidtransModal, closeMidtransModal, fulfillmentList, courierOptions, getFulfillmentByInvoice, updateFulfillmentAddress, updateFulfillmentCourier, updateFulfillmentTracking, recordShippingPayment, confirmFulfillmentReceived,
    aturJadwalHarian: (date, time, note) => commit('daily-schedule', () => api.aturJadwalHarian(date, time, note), 'Jadwal tersimpan.'),
    aturDurasiKategori: (category, duration) => commit(`category:${category}`, () => api.aturDurasiKategori(category, duration), 'Durasi kategori tersimpan.'),
    bukaLelangSerentakHariIni: () => commit('open-auctions', () => api.bukaLelangSerentak(), 'Lelang terjadwal dibuka.'),
  };
  return <AuctionContext.Provider value={value}>{children}</AuctionContext.Provider>;
};

export const useAuction = () => {
  const context = useContext(AuctionContext);
  if (!context) throw new Error('useAuction must be used within an AuctionProvider');
  return context;
};
