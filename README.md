# Meta Reklam Botu

Manifest V3 Chrome eklentisi. Meta Reklam Kütüphanesi'nin yüklenmiş reklam kartlarını toplar; reklam metni, ham kart metni, kütüphane kimliği, bağlantılar, erişilebilir medya adresleri ve platform etiketlerini yerel olarak saklar.

## Kurulum ve kullanım

1. Bu depoyu indirin. Derleme veya uygulama bağımlılığı kurulumu gerekmez.
2. Chrome'da `chrome://extensions` sayfasını açın, **Geliştirici modu**nu etkinleştirin ve **Paketlenmemiş öğe yükle** ile depo klasörünü seçin.
3. `https://www.facebook.com/ads/library/` sayfasını açın. Eklenti güncellendiyse hem eklentiyi hem bu sekmeyi yenileyin.
4. Meta sayfasından arama, ülke ve reklam durumu filtrelerini seçin. Eklentide maksimum reklam sayısını, scroll hızını ve otomatik scroll tercihini ayarlayıp **Scraping Başlat** düğmesine basın.
5. Panel kapansa da açık sayfadaki tarama devam eder. Her normal kaydırmadan sonra MutationObserver ile yeni benzersiz kartlar beklenir (en fazla 4 saniye; yeni kart gelince erken devam eder). Hız, kaydırma mesafesini belirler. Altı ardışık kaydırmada yeni ID gelmezse en fazla üç kurtarma turu yapılır: uygun Daha fazla göster/See more/Load more düğmesi, 600 px yukarı ve tekrar en alta scroll, görünür yükleme göstergesi için en fazla 10 saniye bekleme ve 1/2/4 saniyelik artan DOM bekleme üst sınırı. İlk verimsiz kaydırmadan itibaren iki dakikalık bütçe uygulanır; yeni ID gelirse bütçe sıfırlanır. Başarısız kurtarmada durum ve teşhis “Meta daha fazla reklam yüklemedi (X benzersiz reklam)” der. Otomatik scroll kapalıysa yalnızca yüklenmiş görünür kartlar alınır. İlk yükleme için 12 saniyeye kadar DOM beklemesi vardır; Durdur tüm beklemeleri keser.
6. Tarama bitince CSV veya JSON indirin. Filtreler sekmesindeki medya/platform tercihleri dışa aktarıma uygulanır; sayaç toplam toplanan reklamları gösterir. Temizle yalnızca son sonuçları siler; geçmiş ayrı temizlenir.

Son sonuçlar her başarılı yeni taramada yenilenir. Geçmiş son 100 oturumu listeler; ayrıntılı reklam arşivleri yaklaşık 3 MB bütçeyle saklanır. Bütçeyi aşan eski kayıtlar özet olarak korunur ve arayüzde belirtilir. Geçmiş sekmesinden tek oturumu veya tüm mevcut arşivleri CSV/JSON indirebilirsiniz. Eski sürümlerden kalan yalnızca özet kayıtlar için reklam verisi sonradan üretilemez.

Rakip Takip listesine marka ekleyip Reklamları aç bağlantısıyla aramasını başlatın. Tamamlanan taramanın arama terimi veya reklamveren adı listedeki markayla eşleşirse reklam sayısı ve önceki taramaya göre yeni kimlikler listelenir. Bu karşılaştırma o taramada toplanan kartları kapsar; zamanlanmış bağımsız tarama yapmaz.

## Dosyalar

- `background.js`: Tek oturum sahipliği, kalıcı durum, kaynak doğrulaması, sekme yaşam döngüsü, geçmiş ve ayar yazımları. Worker yeniden başladığında oturumu depolamadan okur, gerektiğinde content script bağlantısını denetler.
- `content.js`: Sayfa DOM'undan reklam çıkarma, yinelenen kimlikleri eleme ve scroll. Oturum kimliğiyle worker'a ilerleme/sonuç mesajları gönderir.
- `popup.html`, `popup.css`, `popup.js`: Dört sekmeli panel, durum/sayaçlar, komutlar, filtreli dışa aktarma ve erişilebilir klavye geçişleri.
- `manifest.json`: MV3 worker ve yalnızca Meta Ad Library sayfalarında etkin content script. `activeTab`, `storage`, `scripting` ve `alarms` izinleri kullanılır. Host izinleri `www.facebook.com` ve `api.telegram.org` ile sınırlıdır. Scripting, açık Meta sekmesine content script bağlantısı eksikse betiği yüklemek içindir; alarms, Telegram yeniden denemelerini sürdürür. Chrome 120+ gerektirir.

## Güncel sürümü yükleme

Bu paket **v0.8.0** olarak sürümlenmiştir. `chrome://extensions` üzerinden doğru depo klasöründen yüklenen eklentiyi yenileyin ve açık Meta sekmesini bir kez yeniden yükleyin. Panelin altında v0.8.0 görünmelidir; görünmüyorsa Chrome başka/eski bir klasörü çalıştırıyordur. Worker, eski sayfa betiğini sürüm kontrolüyle saptar ve önceki sonuçları silmeden yenileme ister. Tarama panelindeki aday/kart sayıları güncel betiğin gerçekten hangi kapsayıcıları işlediğini gösterir.

Kart keşfi artık hiçbir sınıf/border seçicisine dayanmaz. `(Kütüphane Kodu|Library ID)\s*:?\s*(\d{10,})` metninin en küçük eşleşen öğesinden yukarı çıkar; aynı ID ile reklam detayları kontrolünü ve Sponsorlu/Sponsored metninin üstündeki reklamveren adını kapsayan ilk öğeyi seçer. Farklı ID içeren üst sonuç listeleri kart olarak kabul edilmez. Aynı ID bir oturumda yalnızca bir kez saklanır. Türkçe/İngilizce başlangıç tarihleri ISO gün olarak çıkarılır; platform etiketleri ve görsel/video türü de kaydedilir. Eksik tarihler uydurulmaz. Aday/kart teşhisinin yanında sayfadaki “Kütüphane Kodu” metni sayısı gösterilir. Bu kontroller sınıfsız ve rastgele sınıflı DOM örnekleriyle doğrulanmıştır; kullanıcının canlı Meta sayfası bu ortamda incelenmemiştir.

## Kurtarma, kayıt güvenliği ve devam

Toplanan veriler her 25 yeni reklamda ve her tamamlanan DOM geçişinde `storage.local` içine yazılır. Aradaki onaylanmış kayıtlar worker'ın session tamponunda tutulur; sekme kapanır/yenilenirse worker bunları son kalıcı veriyle birleştirir. Popup kapanması taramayı veya tamponu silmez. Browser'ın tamamen kapanması session alanını temizlediğinden, bu durumda son kalıcı checkpoint geçerlidir.

**Devam Et** son kalıcı reklam kümesini ve kaydırma sayısını yükleyerek mevcut Meta sekmesinde devam eder; eski ID'ler atlanır. Meta'nın sanallaştırılmış liste konumu otomatik geri getirilemez: sayfa yenilendiyse daha önce yüklenmiş kartların üzerinden geçilmesi gerekebilir. Maksimum sayı kayıtlı reklam sayısından yüksek olmalıdır. Yeni Taramayı Başlat ayrı ve sıfırdan bir taramadır.

Panel `~1.100 sonuç / results` metninden Meta'nın yaklaşık sayısını okur, benzersiz toplanan sayıdan ayrı gösterir. Bu tahmin kesin hedef veya tüm kayıtların erişilebilirlik garantisi değildir. “Birden fazla versiyonu var / multiple versions” etiketi taşıyan kartların her ayrı DOM gösterimi bir karşılaşma sayılır; aynı DOM öğesinin tekrar kontrolü sayılmaz. Bu değer gerçek versiyon adedinin tahmini değildir ve devam edilen yeni sayfa gösterimleri yeni karşılaşma sayılabilir.

## Canlı durum barı

Tarama sekmesinin en üstündeki sticky bar, 40 px kalın sayaçlarla reklam/scroll sayılarını ve Hazır, Taranıyor…, Durduruldu, Tamamlandı durumlarını gösterir. Nokta yalnızca tarama sırasında pulse yapar; sayaç değişiminde kısa tık animasyonu olur. Azaltılmış hareket tercihi iki animasyonu da kapatır. Sayılar `tr-TR` biçimindedir. `ad-count`, `scroll-count`, `scan-status` ID'leri korunmuştur; eski `.counter-grid` kaldırılmıştır.

Content script her yeni reklam ve her scroll sonrasında `{type: "SCAN_PROGRESS", ads, scrolls, status, sessionId}` gönderir. Worker sekme/oturum sahipliğini ve monoton sayaçları doğrular, session kaydını sürümleyerek popup'a iletir; content script de onaylanan sayıları `chrome.storage.session.scanProgress` içine yazar. Popup açıldığında session verisini okur ve aktif oturumu doğrular; pencerenin kapanması açık Meta sekmesindeki taramayı durdurmaz. Yeni tarama ve Temizle sayaçları sıfırlar. Maksimuma ulaşıldığında Tamamlandı gösterilir. Geç veya eski oturuma ait mesajlar taramayı yeniden başlatmaz.

Session alanı yalnızca bu genel sayaçlar için content script erişimine açılmıştır; Telegram sırları güvenilen bağlamlara özel `storage.local` içinde kalır. Browser oturumu sona ererse `storage.session` Chrome tarafından temizlenir; worker son kalıcı tarama durumunu yerelden yeniden oluşturur.

## Panel ve analiz

Panel `width: 420px !important; min-width: 420px !important;` ile sabit 420 px genişlik ve 600 px yüksekliktedir; uzun sekmeler içeriden kaydırılır; üstteki tema düğmesi açık/koyu görünümü değiştirir ve tercihi yerelde saklar. Hesap sekmesi yoktur. Tarama, Geçmiş, Rakip Takip ve Filtreler sekmeleri önceki veri/Telegram işlevlerini korur.

Tüm CSV/JSON/XLSX indirmeleri (geçmiş dahil) aynı sırada yalnızca şu 12 alanı içerir: `Reklam ID`, `Reklam Veren`, `Metin (Primary Text)`, `Başlık (Headline)`, `Yayın Başlangıç`, `Yaş (gün)`, `Medya Türü`, `Medya URL`, `CTA`, `Hedef URL`, `Platformlar`, `Reklam Linki`. Aynı ID tekrarlanmaz; ID metin olarak korunur. Ham alanlar, oturum kimliği veya tarama zamanı dışa aktarılmaz.

CSV UTF-8 BOM içerir, her hücre tırnaklıdır ve hücre içi satır sonları korunur. JSON aynı Türkçe anahtarlarla düz nesne dizisidir. Excel gerçek OOXML/ZIP `.xlsx` dosyasıdır: tek `Reklamlar` sayfası, kalın/sabit başlık, okunur sütun genişlikleri, metin biçimli ID ve satır kaydırmalı ana metin içerir. XML/CSV dosyasına XLSX uzantısı verilmez. Excel'in 32.767 karakterlik hücre sınırına ulaşılırsa açık hata gösterilir; tam veri CSV/JSON ile indirilebilir. `ad-data.js` ortak şema/temizleme kurallarını, `xlsx.js` bağımlılıksız OOXML üretimini içerir.

Başlık yalnızca CTA'nın üstündeki DOM başlık öğesinden alınır; metinden tahmin edilmez. Alan adı veya WHATSAPP etiketi başlık sayılmaz. Ana metinden video zamanları, tekrarlar ve alt link bloğu çıkarılır. Başlangıç tarihleri Türkçe tam/kısaltılmış ayları ve İngilizce ayları destekler; yaş tarayıcının bugünkü yerel takvim gününe göre hesaplanır. Eksik alanlar boş kalır. Video URL yalnızca erişilebilir HTTP(S) MP4 kaynağıdır; blob/MSE kaynağından MP4 uydurulmaz. Görsellerde profil/ikonlar elenir, en büyük ana kreatif seçilir; çoklu kaydırılabilir kreatif `Carousel` olarak işaretlenir. Platformlar yalnızca `aria-label`/`alt`/`title` bilgilerinden alınır. Yönlendirme URL'leri çözülür, kampanya parametreleri silinir, WhatsApp/Instagram/Messenger hedefleri boş bırakılır.

Yeni taramalarda `rawText` yalnızca ayrıştırma belleğinde kullanılır ve sonuçlara/depolamaya eklenmez. Önceki sürümlerin arşivlerindeki ham alanlar dışa aktarımda elenir; DOM'dan yeniden çıkarılamayan eski başlık/CTA bilgisi tahmin edilmez. Panelde `Başlık: X/Y, CTA: X/Y, Tarih: X/Y, Medya URL: X/Y, Hedef URL: X/Y` doluluk teşhisi gösterilir. Örnek çıktı: `examples/reklamlar-ornek.csv`.

Tarih Analizi, `startDate` veya kartta açıkça etiketlenmiş Türkçe/İngilizce başlangıç tarihlerini kullanır; toplama zamanını reklam başlangıcı saymaz. En eski/yeni başlangıç, ortalama yaş, 30+ günlük, son 7 günlük ve bugün başlayan reklam sayıları gösterilir. Tarihi olmayan reklamlar hesaplamaya katılmaz; kapsama sayısı panelde belirtilir. “Test” ve “Uzun süreli” kutuları yaş gruplarıdır, reklamın performansı hakkında hüküm vermez.

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
node tests/export.test.cjs
node tests/scan-loop.test.cjs
```

Örnek CSV ve XLSX yapısını ayrıca Python `openpyxl` ile doğrulamak için: `python3 tests/verify-export.py` (önce export testini çalıştırın).

Tarayıcı entegrasyon testi Playwright gerektirir. Geçici bir dizinde kurarak depo bağımlılıklarını değiştirmeden çalıştırabilirsiniz:

```sh
npm install --prefix /tmp/meta-browser-check --no-save playwright
NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/browser.cjs
```

`CHROMIUM_PATH` yerine kurulu Chromium yolunu kullanın veya Playwright'ın kendi Chromium'u kuruluysa değişkeni atlayın. Testler yerel örnek HTML ve Chrome API taklidi kullanır; canlı Facebook veya gerçek Chrome eklenti yüklemesini doğrulamaz. Worker testleri eşzamanlı başlangıçları, yeniden başlatmayı, mesaj kaynaklarını, sekme kaybını, kota hatasını, rakip karşılaştırmasını, arşivleri, Telegram kimlik bilgisi gizliliğini, başarılı/hatalı API yanıtlarını ve yeniden deneme kuyruğunu kapsar. Tarayıcı testi üç betiği birlikte çalıştırarak veri çıkarma, paneli yeniden açma, durdurma, geçmiş, rakip listesi, filtreler arşiv indirmeleri, Telegram formu/test/tamamlanma mesajları ve CSV/JSON içeriğini kontrol eder.

## Sınırlar

DOM çıkarımı yalnızca en az 10 haneli Kütüphane Kodu/Library ID, detaylar kontrolü ve reklamveren/sponsor başlığı birlikte bulunduğunda kart üretir. Yeni taramalarda parmak iziyle kimliksiz reklam üretilmez. Önceki sürümlerin arşivleri korunur. Meta etiketleri veya dil desteği değişirse uyarlama gerekebilir. Gizli, henüz yüklenmemiş veya erişim gerektiren reklamlar toplanmaz. Metinler yalnızca yüklenmiş kapsamlarıyla alınır. Medya bağlantıları geçici olabilir; reklamveren, platform veya medya bulunamazsa eksik bırakılır. Platformu bilinmeyen kayıtlar yalnızca Tüm platformlar seçeneğine dahil edilir; filtreler eksik medyayı tahmin etmez. CSV metinleri elektronik tablo formüllerinin çalışmasını engellemek için kaçışlanır.

Sonuçlar Chrome'un yerel depolama kotasına tabidir. Bir yazım başarısız olursa tarama durur ve son başarılı kayıt korunur. Canlı Meta sayfası ve gerçek eklenti yüklemesi bu ortamda doğrulanmadı. Kullanım için kendi tarayıcınızda paketlenmemiş eklentiyle kontrol edin.
