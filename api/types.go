package api

type Response struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type UserRole string

const (
	RoleMasyarakat    UserRole = "masyarakat"
	RolePetugas       UserRole = "petugas"
	RoleAdministrator UserRole = "administrator"
)

type RegisterRequest struct {
	NIK         string `json:"nik"`
	NamaLengkap string `json:"nama_lengkap"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	Telp        string `json:"telp"`
	Alamat      string `json:"alamat"`
}

type SubmitBarangRequest struct {
	NamaBarang       string            `json:"nama_barang"`
	Kategori         string            `json:"kategori"` // Kendaraan, Elektronik & Gadget, dll
	HargaAwal        float64           `json:"harga_awal"`
	ReservePrice     float64           `json:"reserve_price"`
	DeskripsiBarang  string            `json:"deskripsi_barang"`
	FotoBarang       []string          `json:"foto_barang"`
	DokumenPendukung []string          `json:"dokumen_pendukung"`
	Spesifikasi      map[string]string `json:"spesifikasi"`
	EstimasiPasar    float64           `json:"estimasi_pasar"`
}

type ValidasiBarangRequest struct {
	Status           string  `json:"status"` // 'approved' atau 'rejected'
	CatatanKurasi    string  `json:"catatan_kurasi"`
	KelipatanMinimal float64 `json:"kelipatan_minimal,omitempty"`
	UangJaminan      float64 `json:"uang_jaminan,omitempty"`
	ReservePrice     float64 `json:"reserve_price,omitempty"`
}

type AturJadwalRequest struct {
	TanggalLelang string `json:"tanggal_lelang"` // YYYY-MM-DD
	JamBuka       string `json:"jam_buka"`       // HH:MM:SS misal "09:00:00"
	Catatan       string `json:"catatan,omitempty"`
}

type AturDurasiKategoriRequest struct {
	NamaKategori string `json:"nama_kategori"`
	DurasiJam    int    `json:"durasi_jam"` // 5, 8, atau 10 jam
}

type BidRequest struct {
	PenawaranHarga float64 `json:"penawaran_harga"`
}

type PaymentSnapRequest struct {
	IDLelang       int    `json:"id_lelang,omitempty"`
	IDPembayaran   int    `json:"id_pembayaran,omitempty"`
	JumlahTagihan  int64  `json:"jumlah_tagihan,omitempty"`
	TipePembayaran string `json:"tipe_pembayaran,omitempty"` // 'pelunasan' atau 'topup'
	RequestID      string `json:"request_id,omitempty"`
}

type SelesaikanOrderRequest struct {
	Rating int    `json:"rating"`
	Ulasan string `json:"ulasan"`
}
