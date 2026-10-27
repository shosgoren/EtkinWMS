// T-1058: cari listesinin sayfa boyu. Sayfa bileşeni ilk sayfayı, `loadMorePartiesAction` sonrakileri aynı domain okuyucusuyla okur
// (`listParties`, `stock.view`; keyset imleç, OFFSET yok).
export const PARTIES_PAGE_SIZE = 50;
