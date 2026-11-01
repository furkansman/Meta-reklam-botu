# Meta Reklam Botu

Manifest V3 Chrome eklentisi. Meta Reklam Kütüphanesi'nin yüklenmiş reklam kartlarını toplar; reklam metni, ham kart metni, kütüphane kimliği, bağlantılar, erişilebilir medya adresleri ve platform etiketlerini yerel olarak saklar.

## Kurulum ve kullanım

1. Bu depoyu indirin. Derleme veya uygulama bağımlılığı kurulumu gerekmez.
2. Chrome'da `chrome://extensions` sayfasını açın, **Geliştirici modu**nu etkinleştirin ve **Paketlenmemiş öğe yükle** ile depo klasörünü seçin.
3. `https://www.facebook.com/ads/library/` sayfasını açın. Eklenti güncellendiyse hem eklentiyi hem bu sekmeyi yenileyin.
4. Meta sayfasından arama, ülke ve reklam durumu filtrelerini seçin. Eklentide maksimum reklam sayısını, scroll hızını ve otomatik scroll tercihini ayarlayıp **Scraping Başlat** düğmesine basın.
5. Panel kapansa da açık sayfadaki tarama devam eder. Aynı anda bir tarama çalışır. Durdur düğmesi, maksimum sayı, sekmenin kapanması/değişmesi veya art arda sekiz kontrolde yeni reklam bulunamaması taramayı sonlandırır. Otomatik scroll kapalıysa yalnızca mevcut görünür kartlar işlenir.
6. Tarama bitince CSV veya JSON indirin. Filtreler sekmesindeki medya/platform tercihleri dışa aktarıma uygulanır; sayaç toplam toplanan reklamları gösterir. Temizle yalnızca son sonuçları siler; geçmiş ayrı temizlenir.

Her başarılı yeni tarama önceki sonuçların yerini alır; gereken verileri önce dışa aktarın. Geçmiş son 100 oturumun özetini saklar, eski reklamların tam arşivi değildir. Rakip Takip manuel marka listesi ve ilgili Meta aramasını açan bağlantılar sunar; zamanlanmış rakip izleme yapmaz.

## Dosyalar

- `background.js`: Tek oturum sahipliği, kalıcı durum, kaynak doğrulaması, sekme yaşam döngüsü, geçmiş ve ayar yazımları. Worker yeniden başladığında oturumu depolamadan okur, gerektiğinde content script bağlantısını denetler.
- `content.js`: Sayfa DOM'undan reklam çıkarma, yinelenen kimlikleri eleme ve scroll. Oturum kimliğiyle worker'a ilerleme/sonuç mesajları gönderir.
- `popup.html`, `popup.css`, `popup.js`: Dört sekmeli panel, durum/sayaçlar, komutlar, filtreli dışa aktarma ve erişilebilir klavye geçişleri.
- `manifest.json`: MV3 worker ve yalnızca Meta Ad Library sayfalarında etkin content script. `storage` ve `activeTab` izinleri kullanılır.

## Kontroller

Node.js 20+ ile bağımlılıksız worker testleri:

```sh
node tests/background.test.cjs
```

Tarayıcı entegrasyon testi Playwright gerektirir. Geçici bir dizinde kurarak depo bağımlılıklarını değiştirmeden çalıştırabilirsiniz:

```sh
npm install --prefix /tmp/meta-browser-check --no-save playwright
NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/browser.cjs
```

`CHROMIUM_PATH` yerine kurulu Chromium yolunu kullanın veya Playwright'ın kendi Chromium'u kuruluysa değişkeni atlayın. Testler yerel örnek HTML ve Chrome API taklidi kullanır; canlı Facebook veya gerçek Chrome eklenti yüklemesini doğrulamaz. Worker testleri eşzamanlı başlangıçları, yeniden başlatmayı, mesaj kaynaklarını, sekme kaybını, kota hatasını ve ayar işlemlerini kapsar. Tarayıcı testi üç betiği birlikte çalıştırarak veri çıkarma, paneli yeniden açma, durdurma, geçmiş, rakip listesi, filtreler ve CSV/JSON içeriğini kontrol eder.

## Sınırlar

DOM çıkarımı Türkçe/İngilizce kütüphane kimliği etiketlerini temel alır; Meta'nın HTML yapısı/dili değişirse güncelleme gerekebilir. Gizli, henüz yüklenmemiş veya erişim gerektiren reklamlar toplanmaz. Metinler yalnızca yüklenmiş kapsamlarıyla alınır. Medya bağlantıları geçici olabilir; reklamveren, platform veya medya bulunamazsa eksik bırakılır. Platformu bilinmeyen kayıtlar yalnızca Tüm platformlar seçeneğine dahil edilir; filtreler eksik medyayı tahmin etmez. CSV metinleri elektronik tablo formüllerinin çalışmasını engellemek için kaçışlanır.

Sonuçlar Chrome'un yerel depolama kotasına tabidir. Bir yazım başarısız olursa tarama durur ve son başarılı kayıt korunur. Canlı Meta sayfası ve gerçek eklenti yüklemesi bu ortamda doğrulanmadı. Kullanım için kendi tarayıcınızda paketlenmemiş eklentiyle kontrol edin.
