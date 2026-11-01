# Meta Reklam Botu

Manifest V3 Chrome eklentisi. Meta Reklam Kütüphanesi'nin yüklenmiş reklam kartlarını toplar; reklam metni, ham kart metni, kütüphane kimliği, bağlantılar, erişilebilir medya adresleri ve platform etiketlerini yerel olarak saklar.

## Kurulum ve kullanım

1. Bu depoyu indirin. Derleme veya uygulama bağımlılığı kurulumu gerekmez.
2. Chrome'da `chrome://extensions` sayfasını açın, **Geliştirici modu**nu etkinleştirin ve **Paketlenmemiş öğe yükle** ile depo klasörünü seçin.
3. `https://www.facebook.com/ads/library/` sayfasını açın. Eklenti güncellendiyse hem eklentiyi hem bu sekmeyi yenileyin.
4. Meta sayfasından arama, ülke ve reklam durumu filtrelerini seçin. Eklentide maksimum reklam sayısını, scroll hızını ve otomatik scroll tercihini ayarlayıp **Scraping Başlat** düğmesine basın.
5. Panel kapansa da açık sayfadaki tarama devam eder. Aynı anda bir tarama çalışır. Durdur düğmesi, maksimum sayı, sekmenin kapanması/değişmesi veya art arda sekiz kontrolde yeni reklam bulunamaması taramayı sonlandırır. Otomatik scroll kapalıysa yalnızca mevcut görünür kartlar işlenir.
6. Tarama bitince CSV veya JSON indirin. Filtreler sekmesindeki medya/platform tercihleri dışa aktarıma uygulanır; sayaç toplam toplanan reklamları gösterir. Temizle yalnızca son sonuçları siler; geçmiş ayrı temizlenir.

Son sonuçlar her başarılı yeni taramada yenilenir. Geçmiş son 100 oturumu listeler; ayrıntılı reklam arşivleri yaklaşık 3 MB bütçeyle saklanır. Bütçeyi aşan eski kayıtlar özet olarak korunur ve arayüzde belirtilir. Geçmiş sekmesinden tek oturumu veya tüm mevcut arşivleri CSV/JSON indirebilirsiniz. Eski sürümlerden kalan yalnızca özet kayıtlar için reklam verisi sonradan üretilemez.

Rakip Takip listesine marka ekleyip Reklamları aç bağlantısıyla aramasını başlatın. Tamamlanan taramanın arama terimi veya reklamveren adı listedeki markayla eşleşirse reklam sayısı ve önceki taramaya göre yeni kimlikler listelenir. Bu karşılaştırma o taramada toplanan kartları kapsar; zamanlanmış bağımsız tarama yapmaz.

## Dosyalar

- `background.js`: Tek oturum sahipliği, kalıcı durum, kaynak doğrulaması, sekme yaşam döngüsü, geçmiş ve ayar yazımları. Worker yeniden başladığında oturumu depolamadan okur, gerektiğinde content script bağlantısını denetler.
- `content.js`: Sayfa DOM'undan reklam çıkarma, yinelenen kimlikleri eleme ve scroll. Oturum kimliğiyle worker'a ilerleme/sonuç mesajları gönderir.
- `popup.html`, `popup.css`, `popup.js`: Dört sekmeli panel, durum/sayaçlar, komutlar, filtreli dışa aktarma ve erişilebilir klavye geçişleri.
- `manifest.json`: MV3 worker ve yalnızca Meta Ad Library sayfalarında etkin content script. `activeTab`, `storage`, `scripting` ve `alarms` izinleri kullanılır. Host izinleri `www.facebook.com` ve `api.telegram.org` ile sınırlıdır. Scripting, açık Meta sekmesine content script bağlantısı eksikse betiği yüklemek içindir; alarms, Telegram yeniden denemelerini sürdürür. Chrome 120+ gerektirir.

## Telegram bildirimleri

1. Telegram'da BotFather ile bir bot oluşturup token alın. Botunuzla önce `/start` üzerinden konuşun; grup/kanal kullanıyorsanız botun mesaj gönderebildiğinden emin olun.
2. Filtreler sekmesinde Bot Token ve Chat ID alanlarını doldurun, bildirimleri etkinleştirip kaydedin. Sayısal kullanıcı/grup kimliği veya `@kanaladi` kabul edilir.
3. **Test mesajı** düğmesiyle erişimi doğrulayın. Kaydedilmiş tokenı değiştirmeyecekseniz token alanını boş bırakın. **Bilgileri sil**, yerel ayarları ve bekleyen gönderimleri kaldırır.
4. Tarama tamamlandığında reklam sayısı, scroll sayısı, sonuç durumu ve kaynak sayfa bağlantısı Telegram `sendMessage` API'sine HTTPS POST ile gönderilir. Geçmişteki **Telegram özeti** düğmesiyle ayrıca rapor isteyebilirsiniz. Reklam metinlerinin tamamı veya medya dosyaları Telegram'a gönderilmez.

Token yalnızca Chrome'un yerel alanında tutulur; Sync'e, geçmişe, CSV/JSON çıktısına veya genel durum mesajlarına dahil edilmez. Yerel depolama şifreli bir sır kasası değildir. Content script'lerin depolama erişimi `TRUSTED_CONTEXTS` ile kapatılır. Token kullanıcı arayüzüne geri doldurulmaz ve API hatalarında adres/ham yanıt günlüklenmez.

Bildirim kuyruğu kalıcıdır (en fazla 50 rapor). Ağ hataları, HTTP 429 ve 5xx yanıtlarında en fazla üç gönderim girişimi yapılır; 429 bekleme süresine uyulur. HTTP 4xx kimlik/izin hataları tekrar denenmez; geçmişte durum gösterilir. Tarayıcının açık ve İnternet bağlantısının kullanılabilir olması gerekir. Telegram API idempotency anahtarı sunmadığından, gönderimden hemen sonra worker'ın kapanması veya ağ zaman aşımı nadiren yinelenen bildirim üretebilir. Gerçek bot kimlik bilgileriyle bu ortamda mesaj gönderilmedi; testler taklit API yanıtlarını kullanır.

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

`CHROMIUM_PATH` yerine kurulu Chromium yolunu kullanın veya Playwright'ın kendi Chromium'u kuruluysa değişkeni atlayın. Testler yerel örnek HTML ve Chrome API taklidi kullanır; canlı Facebook veya gerçek Chrome eklenti yüklemesini doğrulamaz. Worker testleri eşzamanlı başlangıçları, yeniden başlatmayı, mesaj kaynaklarını, sekme kaybını, kota hatasını, rakip karşılaştırmasını, arşivleri, Telegram kimlik bilgisi gizliliğini, başarılı/hatalı API yanıtlarını ve yeniden deneme kuyruğunu kapsar. Tarayıcı testi üç betiği birlikte çalıştırarak veri çıkarma, paneli yeniden açma, durdurma, geçmiş, rakip listesi, filtreler arşiv indirmeleri, Telegram formu/test/tamamlanma mesajları ve CSV/JSON içeriğini kontrol eder.

## Sınırlar

DOM çıkarımı Türkçe/İngilizce kütüphane kimliği etiketlerini temel alır; Meta'nın HTML yapısı/dili değişirse güncelleme gerekebilir. Gizli, henüz yüklenmemiş veya erişim gerektiren reklamlar toplanmaz. Metinler yalnızca yüklenmiş kapsamlarıyla alınır. Medya bağlantıları geçici olabilir; reklamveren, platform veya medya bulunamazsa eksik bırakılır. Platformu bilinmeyen kayıtlar yalnızca Tüm platformlar seçeneğine dahil edilir; filtreler eksik medyayı tahmin etmez. CSV metinleri elektronik tablo formüllerinin çalışmasını engellemek için kaçışlanır.

Sonuçlar Chrome'un yerel depolama kotasına tabidir. Bir yazım başarısız olursa tarama durur ve son başarılı kayıt korunur. Canlı Meta sayfası ve gerçek eklenti yüklemesi bu ortamda doğrulanmadı. Kullanım için kendi tarayıcınızda paketlenmemiş eklentiyle kontrol edin.
