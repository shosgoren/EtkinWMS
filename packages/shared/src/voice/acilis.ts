// T-1110 (kullanıcı 28 Ekim: "ürünleri aç / kullanıcı ayarlarına git diyorum olmuyor"): ekran açma niyetinin anahtar sözcükleri. Sözcükler
// Türkçe ekleriyle gelir ("ürünleri", "ayarlarına", "carilere"): kök öneki eşleşir. Hedef modül kimliği (kabuk `modules.ts`) + isteğe bağlı
// alt sekme döner; modülün yetkiyle süzülmüş adresini istemci kendisi bulur (yetkisiz modül açılmaz). Saf işlev: DB yok.
import { words } from "./turkce.ts";

export interface OpenTarget {
  /** Kabuk modül kimliği (`urun`, `ayar`, …). */
  readonly id: string;
  /** Modül adresine eklenecek alt yol/sorgu ("?sekme=kullanici", "/baglantilar"). */
  readonly suffix?: string;
}

/** [kök önekleri, hedef]. Önce özel (çok sözcüklü/alt sekme) kurallar, sonra genel. Kök en az 3 harf; sözcük kökle başlar. */
const RULES: readonly (readonly [readonly string[], OpenTarget, (ws: readonly string[]) => boolean])[] = [
  [["ayar"], { id: "ayar", suffix: "?sekme=kullanici" }, (ws) => has(ws, ["kullanici", "uye", "yetki", "personel"])],
  [["ayar"], { id: "ayar", suffix: "?sekme=gorunum" }, (ws) => has(ws, ["gorunum", "tema", "karanlik", "koyu", "acik"])],
  [["entegrasyon", "baglanti", "parasut"], { id: "ayar", suffix: "/baglantilar" }, () => true],
  [["ayar"], { id: "ayar" }, () => true],
  [["kullanici", "uye", "ekip", "personel", "calisan", "eleman"], { id: "ekip" }, () => true],
  [["urun", "malzeme", "katalog"], { id: "urun" }, () => true],
  [["fis", "belge", "evrak", "hareket"], { id: "fis" }, () => true],
  [["stok", "envanter"], { id: "stok" }, () => true],
  [["cari", "musteri", "tedarikci"], { id: "cari" }, () => true],
  [["depo", "raf", "lokasyon"], { id: "depo" }, () => true],
  [["sayim"], { id: "sayim" }, () => true],
  [["toplama"], { id: "topla" }, () => true],
  [["sevkiyat", "satis", "siparis"], { id: "satis" }, () => true],
  [["transfer", "aktarim", "nakil"], { id: "trans" }, () => true],
  [["uretim"], { id: "uret" }, () => true],
  [["etiket", "barkod", "qr"], { id: "qr" }, () => true],
  [["koli", "palet", "paket"], { id: "koli" }, () => true],
  [["okut", "tara"], { id: "tara" }, () => true],
  [["denetim", "kayit", "gecmis", "log"], { id: "kayit" }, () => true],
  [["anasayfa", "pano"], { id: "home" }, () => true],
];

/** Ekran adının yanında anlamı değiştirmeyen sözcükler ("ürünler sayfası", "stok durumu", "tüm cariler"). */
const FILLER = ["sayfa", "ekran", "liste", "menu", "modul", "bolum", "kisim", "sekme", "durum", "tum", "butun", "hepsi", "yonetim"];
/** Alt sekme kurallarının koşul sözcükleri de ekran sözlüğündendir ("kullanıcı ayarları", "tema ayarları"). */
const VOCAB = [
  ...new Set([...RULES.flatMap(([stems]) => stems), ...FILLER, "kullanici", "uye", "yetki", "personel", "gorunum", "tema", "karanlik", "koyu", "acik"]),
];

function has(ws: readonly string[], stems: readonly string[]): boolean {
  return ws.some((w) => stems.some((s) => w.startsWith(s)));
}

/** "ana ekran", "ana sayfa" tek sözcük gibi. */
function join(ws: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    // "ana ekran(a)", "ana sayfa"; ekran sözcüğü komuttan atılmışsa yalnız "ana".
    if (ws[i] === "ana" && (ws[i + 1] === undefined || ws[i + 1]!.startsWith("ekran") || ws[i + 1]!.startsWith("sayfa"))) {
      out.push("anasayfa");
      if (ws[i + 1] !== undefined) i++;
    } else out.push(ws[i]!);
  }
  return out;
}

/** Hedef cümle hangi ekrana gidiyor? Bilinmeyen hedef `null` (çağıran ürün/cari adı ya da modül adı benzerliğine bakar). Yalnız ekran
 * sözlüğünden oluşan hedef ekrandır: "koli bandı 45mm şeffaf" içinde "koli" geçse de ürün adıdır, katalog aramasına düşer. */
export function openTarget(target: string): OpenTarget | null {
  const ws = join(words(target));
  if (ws.length === 0 || !ws.every((w) => w === "anasayfa" || has([w], VOCAB))) return null;
  for (const [stems, out, when] of RULES) if (has(ws, stems) && when(ws)) return out;
  return null;
}
