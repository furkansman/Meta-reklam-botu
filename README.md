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

Rakip Takip artık ayrı, kalıcı bir günlük tarama kuyruğu kullanır. Manuel taramanın sonuçları ve sayaçları rakip taraması tarafından değiştirilmez. Ayrıntılar aşağıdaki Rakip Takip bölümündedir.

## Dosyalar

- `background.js`: Tek oturum sahipliği, kalıcı durum, kaynak doğrulaması, sekme yaşam döngüsü, geçmiş ve ayar yazımları. Worker yeniden başladığında oturumu depolamadan okur, gerektiğinde content script bağlantısını denetler.
- `content.js`: Sayfa DOM'undan reklam çıkarma, yinelenen kimlikleri eleme ve scroll. Oturum kimliğiyle worker'a ilerleme/sonuç mesajları gönderir.
- `popup.html`, `popup.css`, `popup.js`: Dört sekmeli panel, durum/sayaçlar, komutlar, filtreli dışa aktarma ve erişilebilir klavye geçişleri.
- `manifest.json`: MV3 worker ve yalnızca Meta Ad Library sayfalarında etkin content script. `activeTab`, `storage`, `scripting` ve `alarms` izinleri kullanılır. Host izinleri `www.facebook.com` ve `api.telegram.org` ile sınırlıdır. Scripting, açık Meta sekmesine content script bağlantısı eksikse betiği yüklemek içindir; alarms, Telegram yeniden denemelerini sürdürür. Chrome 120+ gerektirir.

## Güncel sürümü yükleme

Bu paket **v0.10.0** olarak sürümlenmiştir. `chrome://extensions` üzerinden doğru depo klasöründen yüklenen eklentiyi yenileyin ve açık Meta sekmesini bir kez yeniden yükleyin. Panelin altında v0.10.0 görünmelidir; görünmüyorsa Chrome başka/eski bir klasörü çalıştırıyordur. Worker, eski sayfa betiğini sürüm kontrolüyle saptar ve önceki sonuçları silmeden yenileme ister. Tarama panelindeki aday/kart sayıları güncel betiğin gerçekten hangi kapsayıcıları işlediğini gösterir.

Kart keşfi artık hiçbir sınıf/border seçicisine dayanmaz. `(Kütüphane Kodu|Library ID)\s*:?\s*(\d{10,})` metninin en küçük eşleşen öğesinden yukarı çıkar; aynı ID ile reklam detayları kontrolünü ve Sponsorlu/Sponsored metninin üstündeki reklamveren adını kapsayan ilk öğeyi seçer. Farklı ID içeren üst sonuç listeleri kart olarak kabul edilmez. Aynı ID bir oturumda yalnızca bir kez saklanır. Türkçe/İngilizce başlangıç tarihleri ISO gün olarak çıkarılır; platform etiketleri ve görsel/video türü de kaydedilir. Eksik tarihler uydurulmaz. Aday/kart teşhisinin yanında sayfadaki “Kütüphane Kodu” metni sayısı gösterilir. Bu kontroller sınıfsız ve rastgele sınıflı DOM örnekleriyle doğrulanmıştır; kullanıcının canlı Meta sayfası bu ortamda incelenmemiştir.

## Kurtarma, kayıt güvenliği ve devam

Toplanan veriler 25 yeni reklamlık artımlı paketler halinde `storage.local` içinde ayrı anahtarlara yazılır; önceki büyük dizi her pakette yeniden yazılmaz. Paket kimliği idempotenttir, yeniden iletim aynı veriyi çoğaltmaz. Aktif veri okuma/dışa aktarma gerektiğinde paketler birleştirilir; tarama bitişinde son küçük paket de kaydedilip kalıcı sonuç normalleştirilir. Ani manuel sekme kapanması/yenilemesi son henüz gönderilmemiş en fazla 24 kaydı kaybettirebilir; otomatik yenilemeden önce bütün bekleyen kayıtlar onaylı olarak yazılır. Browser tamamen kapanırsa yalnızca tamamlanmış yerel paketler garanti edilir.

**Devam Et** son kalıcı reklam kümesini ve kaydırma sayısını yükleyerek mevcut Meta sekmesinde devam eder; eski ID'ler atlanır. Meta'nın sanallaştırılmış liste konumu otomatik geri getirilemez: sayfa yenilendiyse daha önce yüklenmiş kartların üzerinden geçilmesi gerekebilir. Maksimum sayı kayıtlı reklam sayısından yüksek olmalıdır. Yeni Taramayı Başlat ayrı ve sıfırdan bir taramadır.

Panel `~1.100 sonuç / results` metninden Meta'nın yaklaşık sayısını okur, benzersiz toplanan sayıdan ayrı gösterir. Bu tahmin kesin hedef veya tüm kayıtların erişilebilirlik garantisi değildir. “Birden fazla versiyonu var / multiple versions” etiketi taşıyan kartların her ayrı DOM gösterimi bir karşılaşma sayılır; aynı DOM öğesinin tekrar kontrolü sayılmaz. Bu değer gerçek versiyon adedinin tahmini değildir ve devam edilen yeni sayfa gösterimleri yeni karşılaşma sayılabilir.

## Parçalı tarama

Parça yöneticisi `chunk-scan.js`, ek arayüz bağları `chunk-popup.js` içindedir. `content.js`, `scan-loop.js`, `ad-data.js`, XLSX üreticisi, rakip modülü ve Telegram gönderim fonksiyonu değiştirilmez. Onay kutusu kapalıyken mevcut normal tarama yolu kullanılır. Paketin sürümü v0.10.0, değişmeyen içerik motorunun protokol sürümü v0.9.1'dir.

1. Meta Ad Library'de anahtar kelime, ülke, durum ve platform aramanı yap. Bir kez tarih filtresi uygula. Yönetici, mevcut URL'deki ISO gün değerleri taşıyan eşleşen alt/üst tarih parametrelerinin adlarını öğrenir ve `chunkDateParams` içinde saklar; tahmini adlarla başlamaz. Öğrenilmiş adlar yoksa **Sayfada tarih filtresini bir kez uygulayıp tekrar dene** mesajı gösterilir ve mevcut veriler korunur.
2. Tarama sekmesinde **Parçalı tarama** seçeneğini aç. Varsayılan başlangıç 2020-09-01, bitiş İstanbul takviminde bugün, parça hafta, sınır 800 reklam, bekleme 20–40 saniyedir. Son 14/30 gün seçimleri bugün dahil bu kadar takvim gününü kapsar. Normal taramanın Maksimum Reklam ayarı birleşik havuzu sınırlamaz.
3. Yönetici her parçayı ayrı, **öne getirilen** sekmede açar. Kaynak arama parametreleri korunur; tarih alanları değiştirilir. Meta'nın bildirdiği sonuç sınırı aşıyorsa motor başlamadan tarih aralığı ikiye bölünür; sıfır sonuç atlanır. Sonuç okunamazsa mevcut motor çalışır ve sınırda bölme yapılır. Tarihler iki uç dahil, birbirini takip eden aralıklardır; aylık adım takvim ayını kullanır.
4. Tek günlük yoğun parça önce görsel/video, sonra Facebook/Instagram olarak bölünür. Kaynak aramada zaten daraltılmış medya/platform kapsamı genişletilmez. Bu en küçük alt parça da sınırı aşıyorsa **başarısız** olarak listelenir; erişilmiş veriler korunur. Bu alt filtreler tüm olası medya ve platform türlerini kapsama garantisi vermez. Meta'nın yaklaşık sonucuyla benzersiz toplamın eşit olması garanti edilmez.

Ortak havuz ayrı, en fazla 25 reklamlık `chunk-pool:<oturum>:<paket>` anahtarlarında artımlı yazılır. ID'ler Map ile tekilleştirilir; bir önceki büyük reklam dizisi her pakette yeniden yazılmaz. GET_STATE havuzu mevcut reklam yapısında sunar; dışa aktarma fonksiyonları, sütun adları ve sıralaması aynen kalır. **Ham** sayı aynı ID'nin farklı parçalardaki karşılaşmalarını içerir; aynı parçanın yeniden denemesi ham sayıyı tekrar artırmaz. İlk denemede sınırda bölünen üst parçadaki kayıtlar da havuzda korunur.

Durdur, yeni parçaya geçişi keser ve motorun son paketini kaydetmesini bekler. **Devam Et** bitmemiş parçadan sürdürür; tamamlanmış parçaları tekrar açmaz. Popup kapanınca çalışma devam eder. Chrome yeniden başlayınca kalıcı kuyruk duraklatılır ve Devam Et beklenir. Son henüz onaylanmamış paket eski motorun kayıt davranışına tabidir; devam sırasında yarım parça yeniden taranır, havuzdaki ID'ler çoğaltılmaz. Tarayıcı uyku/suspansiyonunda alarm gecikebilir; bekleme zamanı kalıcıdır.

Yükleme için 45 saniyelik, çalışan parça için 10 dakikalık gözetim vardır. Yüklenmeyen, kesilen veya bildirilen sayıya ulaşamayan parça iki kez yeniden denenir; rastgele bekleme ilk denemede 2, ikincide 4 katına çıkar. Son hata diğer parçaları durdurmaz. Bir günlük alt filtre sınırları ve erişim hataları en sonda tam liste halinde görünür. Depolama hatasında onaylanmış paketler korunarak tarama duraklatılır.

Mevcut REKLAM/SCROLL kutularının altında ek satır parça numarası, tarih/filtre, parça sayısı, benzersiz/ham toplam ve reklam/dakika gösterir. İlk verili parçanın hızının yarısının altına düşünce uyarı çıkar. Başlangıç tarihi okunabilen reklamların %25'inden fazlası parça başlangıcından önceyse teşhiste **Meta filtresi pencerede yayında olan reklamları getiriyor, parçalar çakışabilir** notu gösterilir. Bu durumda tekilleştirme yine ID ile yapılır.

Parça başına normal tarama bitiş/Telegram yolu çağrılmaz. Telegram etkinse tüm kuyruk bittiğinde benzersiz sayı, ham sayı, taranan parça sayısı ve başarısız parçalar için mevcut gönderim fonksiyonunu kullanan tek özet işi oluşur. Tek mesaj sınırını aşan hata listesi eklentide tam, Telegram'da kısaltılmış görünür. Ağ/429/5xx hatalarında rapor en fazla üç gönderim girişimiyle kalıcı olarak yeniden denenir.

## Artımlı tarama ve sayfa yükü

Başlangıçta DOM'daki mevcut kartların tamamı bir kez işlenir. Sonra `MutationObserver` yalnızca eklenen düğüm alt ağaçlarını ve değişen metin düğümlerini kuyruğa alır. Bir turda yeni kart işlenemezse tam metin tabanlı keşif güvenlik ağı olarak yeniden çalışır; sıfır yeni reklam kararı bu kontrolden sonra verilir. Sayfanın `body.innerText` değeri okunmaz. İşlenmiş kartlar WeakSet/WeakMap, benzersiz Reklam ID'leri Set/Map ile takip edilir. Meta aynı DOM öğesini başka bir ID için geri dönüştürürse yeni ID işlenebilir. Kartlar ancak ID ve reklam verisi başarıyla çıkarıldıktan sonra işlenmiş sayılır; eksik yüklenen veya ayrıştırılamayan kartlar sonraki turda yeniden denenir. Etiket ve ID farklı bloklara/satırlara bölünebilir; sabit üst öğe derinliği sınırı yoktur. Her tur teşhiste bulunan, yeni işlenen ve kayıtlı olduğu için atlanan kart sayıları gösterilir. İlk 5 saniyede hiç reklam toplanamazsa kaydırmaya geçmeden durur; kart yok, ID okunamadı, eksik reklamveren/detay veya ayrıştırma hatası ayrı açıklanır.

Verisi başarıyla okunmuş, son 100 karttan eski kartlarda boyut korunarak `content-visibility:hidden` uygulanır. Son 100 kartın medyasına müdahale edilmez. Kartlar DOM'dan silinmez. Eski DOM düğümlerinin liste sanallaştırmasıyla atılmasını engellememek için hafifletme geçmişi WeakRef kullanır. Tarama durunca stiller geri alınır; geri dönüştürülmüş bir kart değiştiğinde görünürlüğü açılır. Normal kaydırma `window.scrollTo(0, document.body.scrollHeight)` kullanır. DOM beklemesi en fazla 4 saniyedir; yeni kart gelince erken devam edilir.

Kayıt paketi 25 reklamdır; SCAN_PROGRESS içerik ve worker yayınlarında en fazla saniyede 2 kez gönderilir (son değer birleştirilir). Her 50 yeni reklamda son 50 için reklam/dakika ölçülür. İlk 50'lik pencereye göre hız %70'ten fazla düşerse teşhiste Devam Et önerisi gösterilir. Ölçüm ağ/Meta yükleme beklemesini de kapsar; yalnızca CPU performans puanı değildir.

**Ağırlaşınca otomatik yenile (300 reklamda bir)** seçeneği açıksa her 300 benzersiz kayıtta (maksimum hedefe henüz ulaşılmadıysa) ID'ler/veri, sayaç ve scroll konumu kaydedilip aynı sekme yenilenir. Worker yükleme tamamlandığında yeni oturum kimliğiyle kayıtlı ID'leri ve sayaçları motora geri verir; eski ID'ler tekrar eklenmez. Pozisyon Meta liste yüksekliği elverdiğince geri yüklenir. Yeniden bağlanma başarısızsa 60 saniyelik gözetim kaydı koruyarak taramayı durdurur. Yavaşlama uyarısından sonra manuel Devam Et de sayfayı yeniler.

Kontrollü tarayıcı testi başlangıçtaki derin/satırlara bölünmüş etiketleri, geç yüklenen kartı, başarısız ayrıştırma sonrası yeniden denemeyi, observer olayı gelmeyen turda tam taramayı ve 0 reklamla kaydırmadan durmayı doğrular. Ayrıca 110 kart sonrası eklenen tek düğümde eski kart/body innerText okumalarının artmadığını, 25'lik paketleri, mesaj aralıklarını, hız uyarısını ve 300 ID'den yenileme sonrası 301'e devam etmeyi doğrular. Kullanıcının canlı Meta sayfasında ölçüm yapılmadı.

## Canlı durum barı

Tarama sekmesinin en üstündeki sticky bar, 40 px kalın sayaçlarla reklam/scroll sayılarını ve Hazır, Taranıyor…, Durduruldu, Tamamlandı durumlarını gösterir. Nokta yalnızca tarama sırasında pulse yapar; sayaç değişiminde kısa tık animasyonu olur. Azaltılmış hareket tercihi iki animasyonu da kapatır. Sayılar `tr-TR` biçimindedir. `ad-count`, `scroll-count`, `scan-status` ID'leri korunmuştur; eski `.counter-grid` kaldırılmıştır.

Content script yeni reklam/scroll ilerlemesini birleştirerek en fazla 500 ms’de bir `{type: "SCAN_PROGRESS", ads, scrolls, status, sessionId}` gönderir. Worker sekme/oturum sahipliğini ve monoton sayaçları doğrular, session kaydını sürümleyerek popup'a iletir; content script de onaylanan sayıları `chrome.storage.session.scanProgress` içine yazar. Popup açıldığında session verisini okur ve aktif oturumu doğrular; pencerenin kapanması açık Meta sekmesindeki taramayı durdurmaz. Yeni tarama ve Temizle sayaçları sıfırlar. Maksimuma ulaşıldığında Tamamlandı gösterilir. Geç veya eski oturuma ait mesajlar taramayı yeniden başlatmaz.

Session alanı yalnızca bu genel sayaçlar için content script erişimine açılmıştır; Telegram sırları güvenilen bağlamlara özel `storage.local` içinde kalır. Browser oturumu sona ererse `storage.session` Chrome tarafından temizlenir; worker son kalıcı tarama durumunu yerelden yeniden oluşturur.

## Panel ve analiz

Panel `width: 420px !important; min-width: 420px !important;` ile sabit 420 px genişlik ve 600 px yüksekliktedir; uzun sekmeler içeriden kaydırılır; üstteki tema düğmesi açık/koyu görünümü değiştirir ve tercihi yerelde saklar. Hesap sekmesi yoktur. Tarama, Geçmiş, Rakip Takip ve Filtreler sekmeleri önceki veri/Telegram işlevlerini korur.

CSV/JSON sütun sırası: `Reklam ID`, `Reklam Veren`, `Hook`, `Başlık (Headline)`, `Yayın Başlangıç`, `Yaş (gün)`, `Durum`, `Medya Türü`, `Medya URL`, `CTA`, `Hedef URL`, `Tam Metin`. Aynı ID tekrarlanmaz; ID metindir. Yaşı bilinen reklamlar büyükten küçüğe sıralanır; tarihsizler en sona gelir. Ham alanlar, platform/link listeleri, oturum bilgisi veya tarama zamanı dışa aktarılmaz.

Ayrıştırma kartın görünen `innerText` metninde Sponsorlu/Sponsored sonrasından yapılır. Video süreleri, oynatma hatası ve düşük gösterim uyarısı çıkarılır. Son kalan satır CTA, önceki satır başlıktır; başlığın üzerindeki alan adı satırı elenir. Geriye kalan metin satır sonlarıyla Tam Metin olur; sıkıştırılmış metin tekrarları çıkarılır. Ham kart metni yalnızca bellekte işlenir. Yeni taramalarda yeni kural uygulanır; eski arşivlerin kaybolmuş satır düzeni/CTA bilgisi tahmin edilmez.

Hook, ilk anlamlı paragrafın ilk cümlesidir (en fazla 150 karakter, son tam kelimede kesilip … eklenir). Başlangıçtaki sembol/emoji ve iletişim/bağlantı satırları atlanır. Kısa başlangıç devam satırıyla birleşir; boş satır veya cümle sonu durdurur. Dt., Dr., Uzm., Op., Prof., Doç., Yrd. noktaları cümleyi bitirmez; reklamveren tekrarı baştan çıkarılır. Tam Metin yoksa başlık kullanılır. Yaş grupları: 30+ Uzun süreli, 8–29 Orta, 2–7 Yeni, 0–1 Test; tarih yoksa durum/yaş boştur.

CSV UTF-8 BOM, tamamı tırnaklı hücreler ve hücre içi satır sonları içerir. JSON aynı adlarla düz nesne dizisidir. Gerçek `.xlsx` iki sayfalıdır: **Reklamlar** ilk 11 sütunu içerir, Tam Metin yoktur; beyaz yazılı koyu mavi başlık, `C2` sabitlemesi (ilk iki sütun ve başlık), filtre, metin biçimli ID, kaydırmalı Hook ve renkli durum hücreleri bulunur. **Özet** arama adı/toplam, durum ve medya dağılımları, reklamveren istatistikleri (30+ gün sayısı öncelikli), en çok kullanılan 8 CTA ve ilk üç kelimeye göre tekrar eden hook kalıplarını içerir. İstatistikler dışa aktarılan filtreli/dedüplike kümeden hesaplanır. 32.767 karakterlik Excel hücre sınırı aşılırsa CSV/JSON kullanılması istenir.

Örnekler `examples/ornek-hook-cikti.csv`, `examples/ornek-hook-cikti.json`, `examples/reklam-analizi-hook-ornek.xlsx` dosyalarıdır. Bunlar test verilerinden 2026-11-02 referans günüyle üretilir; kullanıcıya ait reklamlar değildir. Referans ek dosyalar bu sohbette erişilebilir olmadığından dosya görünümüyle birebir karşılaştırma yapılamadı; belirtilen şema ve stil kuralları doğrulandı.

Medya seçimi ve hedef URL temizliği korunmuştur. Teşhis satırında Hook, Başlık, CTA, Tarih, Medya URL ve Hedef URL dolulukları gösterilir. Bu değişiklik tarama döngüsünü, sayaç barını, kurtarma/Devam Et akışını veya ayarları değiştirmez.

Tarih Analizi, `startDate` veya kartta açıkça etiketlenmiş Türkçe/İngilizce başlangıç tarihlerini kullanır; toplama zamanını reklam başlangıcı saymaz. En eski/yeni başlangıç, ortalama yaş, 30+ günlük, son 7 günlük ve bugün başlayan reklam sayıları gösterilir. Tarihi olmayan reklamlar hesaplamaya katılmaz; kapsama sayısı panelde belirtilir. “Test” ve “Uzun süreli” kutuları yaş gruplarıdır, reklamın performansı hakkında hüküm vermez.

## Telegram formu doğrulaması

Gerçek token hiçbir zaman input `value` alanına geri yazılmaz. Kayıt varsa alan boş kalır; placeholder `Kayıtlı token: ••••AbCd (değiştirmek için yeni token yapıştır)` ve durum satırı son dört haneyi gösterir. Boş veya yalnızca nokta/bullet/yıldız yer tutucusu Kaydet/Test işlemlerinde `storage.local` içindeki tokenı kullanır. Yeni yapıştırılan değerde boşluk/satır sonları, tırnaklar ve `bot` öneki temizlenip `^\d{6,}:[A-Za-z0-9_-]{30,}$` doğrulanır; kayıtlı token yeniden doğrulanmaz. Chat ID `^-?\d+$` olmalıdır.

Test mesajı, yeni token/Chat ID girildiyse bunları kaydetmeden dener; aksi halde kayıtlı değerleri kullanır. İçerik `Test: Meta Reklam Botu bağlandı ✓` şeklindedir. Tüm sonuçlar form altındaki `#token-status` satırındadır: kayıtta yeşil Kaydedildi ✓, hatalarda kırmızı mesaj. 401 için BotFather'dan yeni token alınması, chat not found için bota /start yazılması, ağ hatası için ulaşılamadığı söylenir. Telegram description metni tokenlar temizlendikten sonra gösterilir; token, API URL'si veya tam hata nesnesi konsola yazılmaz. Gerçek bot kimlik bilgileri bu ortamda bulunmadığından A bölümü kontrollü API yanıtlarıyla doğrulanmıştır.

## Rakip Takip ve günlük yeni reklam uyarıları

- En fazla **10 marka** ekleyin; marka adını Meta'daki reklamveren adıyla eşleştirin. İsteğe bağlı sayısal Facebook Sayfa ID veya Facebook sayfa linki eklenebilir. Sayfa ID varsa arama o sayfaya kapsamlanır. Vanity link önce arka planda açılıp Meta app-link bilgisinden sayısal ID çözülür; çözülemezse başka sayfaların verisini karıştırmak yerine hata kaydedilir ve sayısal ID istenir.
- **Hepsini şimdi tara** veya marka yanındaki **Şimdi tara** mevcut motoru `active:false` yeni sekmede çalıştırır: Türkiye, tüm reklam türleri, aktif reklamlar; marka başına en fazla 300 kayıt/10 dakika. Yalnızca adı veya sayfa kimliği/linki eşleşen kayıtlar alınır. Eşleşme yoksa eski analiz silinmez.
- Marka bitince yalnızca servis tarafından açılan sekme kapatılır. Sıradaki marka için 30–60 saniye rastgele bekleme `chrome.alarms` ile planlanır. Kuyruk, aktif sekme/oturum ve zaman aşımı kalıcıdır; worker askıya alınsa da devam edebilir. Chrome/Meta arka plan sekmelerini kısıtlarsa tarama başarısız olarak kaydedilebilir; diğer markalara geçilir.
- Günlük saat varsayılan **01:00**, tarayıcının yerel saatidir. Ayar değiştirilince eski günlük alarm silinir, `periodInMinutes:1440` ile yenisi kurulur. Startup/installed olaylarında alarm yeniden doğrulanır. Bilgisayar kapalıyken kaçırılan tarama için açılışta onay düğmeli bildirim ve popup içinde çalıştırma düğmesi gösterilir; kullanıcı onaylamadan kaçırılan iş başlatılmaz. Chrome alarmı gerçek zamanlı bir zamanlayıcı değildir, uyku/yoğunlukta gecikebilir.
- İlk başarılı tarama bir baseline'dır: yeni reklam uyarısı yerine “X marka kaydedildi, değişiklikler bir sonraki taramadan itibaren takip edilecek” raporu hazırlanır. Sonraki taramalarda yeni ve görünmeyen ID'ler kıyaslanır. 300 sınırına ulaşan kısmi sonuçlarda görünmeyen kayıtlar durmuş sayılmaz; sayı tüm Meta veritabanının kesin toplamı değildir. Meta'nın yüklemediği kayıtlar için durma tahmini yapılmaz.
- Her marka son başarılı analizini, yeni/görünmeyen sayılarını, Hook/başlangıç/medya/CTA/link dahil kayıtları saklar. Son tarama ve hatalar listede görünür; yeni Hook'lar açılır listede, **Son analizi Excel indir** ile mevcut iki sayfalı Excel biçiminde indirilebilir.
- Bütün markalardan sonra tek mantıksal Telegram raporu hazırlanır: marka başına en fazla 5 yeni Hook ve link, fazlasının adedi, hata veren markalar ve toplam etkilenen marka sayısı. 4000 karakteri aşarsa parçalanır. **Yeni reklam yoksa da mesaj gönder** kapalıysa, değişiklik/ilk kayıt/hata olmayan tur sessiz kalır.
- Telegram kapalıysa veya gönderim hatalıysa rakip analizi yine saklanır, Türkçe hata Rakip Takip sekmesinde gösterilir. Gönderim sırasında browser'ın kapanması nadiren aynı rapor parçasını tekrar gönderebilir (Telegram'ın idempotency anahtarı yoktur). Günlük izleme için Chrome açık ve Meta oturumu erişilebilir olmalıdır. Bildirim izni reddedilirse kaçırılmış tarama düğmesi popup'ta kalır.

`competitor.js` bu kuyruğu bağımsız yönetir. Rakip mesajları manuel sayaç session kaydına yazılmaz; rakipler de artımlı paketleri kabul eder. Hook/CSV-XLSX şeması ve sayaç barının görünümü korunur. Yeni `notifications` izni ve `icon.png`, kaçırılmış günlük tarama bildirimi içindir. Harici ses/yapay zekâ API'si kullanılmaz.

## Telegram bildirimleri

1. Telegram'da BotFather ile bir bot oluşturup token alın. Botunuzla önce `/start` üzerinden konuşun; grup/kanal kullanıyorsanız botun mesaj gönderebildiğinden emin olun.
2. Filtreler sekmesinde Bot Token ve Chat ID alanlarını doldurun, bildirimleri etkinleştirip kaydedin. Chat ID yalnızca rakamlardan oluşmalıdır; grup kimliğinde başta `-` bulunabilir. `@kanaladi`, `+` ve ondalık işaret kabul edilmez.
3. **Test mesajı** düğmesiyle erişimi doğrulayın. Kaydedilmiş tokenı değiştirmeyecekseniz token alanını boş bırakın. **Bilgileri sil**, yerel ayarları ve bekleyen gönderimleri kaldırır.
4. Tarama tamamlandığında reklam sayısı, scroll sayısı, sonuç durumu ve kaynak sayfa bağlantısı Telegram `sendMessage` API'sine HTTPS POST ile gönderilir. Geçmişteki **Telegram özeti** düğmesiyle ayrıca rapor isteyebilirsiniz. Reklam metinlerinin tamamı veya medya dosyaları Telegram'a gönderilmez.

Token yalnızca Chrome'un yerel alanında tutulur; Sync'e, geçmişe, CSV/JSON çıktısına veya genel durum mesajlarına dahil edilmez. Yerel depolama şifreli bir sır kasası değildir. Content script'lerin depolama erişimi `TRUSTED_CONTEXTS` ile kapatılır. Token input değeri boş tutulur; maskeli bilgi yalnızca placeholder olarak gösterilir ve API hatalarında adres/ham yanıt günlüklenmez.

Bildirim kuyruğu kalıcıdır (en fazla 50 rapor). Ağ hataları, HTTP 429 ve 5xx yanıtlarında en fazla üç gönderim girişimi yapılır; 429 bekleme süresine uyulur. HTTP 4xx kimlik/izin hataları tekrar denenmez; geçmişte durum gösterilir. Tarayıcının açık ve İnternet bağlantısının kullanılabilir olması gerekir. Telegram API idempotency anahtarı sunmadığından, gönderimden hemen sonra worker'ın kapanması veya ağ zaman aşımı nadiren yinelenen bildirim üretebilir. Gerçek bot kimlik bilgileriyle bu ortamda mesaj gönderilmedi; testler taklit API yanıtlarını kullanır.

## Kontroller

Node.js 20+ ile bağımlılıksız worker testleri:

```sh
node tests/background.test.cjs
node tests/export.test.cjs
node tests/scan-loop.test.cjs
node tests/competitor.test.cjs
node tests/chunk-scan.test.cjs
```

Örnek CSV ve XLSX yapısını ayrıca Python `openpyxl` ile doğrulamak için: `python3 tests/verify-export.py` (önce export testini çalıştırın).

Tarayıcı entegrasyon testi Playwright gerektirir. Geçici bir dizinde kurarak depo bağımlılıklarını değiştirmeden çalıştırabilirsiniz:

```sh
npm install --prefix /tmp/meta-browser-check --no-save playwright
NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/browser.cjs
NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/chunk-browser.cjs
```

`CHROMIUM_PATH` yerine kurulu Chromium yolunu kullanın veya Playwright'ın kendi Chromium'u kuruluysa değişkeni atlayın. Testler yerel örnek HTML ve Chrome API taklidi kullanır; canlı Facebook veya gerçek Chrome eklenti yüklemesini doğrulamaz. Worker testleri eşzamanlı başlangıçları, yeniden başlatmayı, mesaj kaynaklarını, sekme kaybını, kota hatasını, rakip karşılaştırmasını, arşivleri, Telegram kimlik bilgisi gizliliğini, başarılı/hatalı API yanıtlarını ve yeniden deneme kuyruğunu kapsar. Tarayıcı testi üç betiği birlikte çalıştırarak veri çıkarma, paneli yeniden açma, durdurma, geçmiş, rakip listesi, filtreler arşiv indirmeleri, Telegram formu/test/tamamlanma mesajları ve CSV/JSON içeriğini kontrol eder.

## Sınırlar

DOM çıkarımı yalnızca en az 10 haneli Kütüphane Kodu/Library ID, detaylar kontrolü ve reklamveren/sponsor başlığı birlikte bulunduğunda kart üretir. Yeni taramalarda parmak iziyle kimliksiz reklam üretilmez. Önceki sürümlerin arşivleri korunur. Meta etiketleri veya dil desteği değişirse uyarlama gerekebilir. Gizli, henüz yüklenmemiş veya erişim gerektiren reklamlar toplanmaz. Metinler yalnızca yüklenmiş kapsamlarıyla alınır. Medya bağlantıları geçici olabilir; reklamveren, platform veya medya bulunamazsa eksik bırakılır. Platformu bilinmeyen kayıtlar yalnızca Tüm platformlar seçeneğine dahil edilir; filtreler eksik medyayı tahmin etmez. CSV metinleri elektronik tablo formüllerinin çalışmasını engellemek için kaçışlanır.

Sonuçlar Chrome'un yerel depolama kotasına tabidir. Bir yazım başarısız olursa tarama durur ve son başarılı kayıt korunur. Canlı Meta sayfası ve gerçek eklenti yüklemesi bu ortamda doğrulanmadı. Kullanım için kendi tarayıcınızda paketlenmemiş eklentiyle kontrol edin.

Parçalı mod testleri tarih sınırlarını, öğrenilmiş parametreleri, ön kontrolü, tarih/medya/platform bölünmesini, tekilleştirmeyi, hız/çakışma teşhisini, iki yeniden denemeyi, sekme kimliği güvenliğini, kayıt hatasını ve normal moda geri dönüşü kapsar. Yeni Chromium testi değiştirilmemiş içerik motoruyla iki gerçek test sekmesini tarar; popup/tarayıcı yeniden başlangıcından devam ederek ham 4 / benzersiz 3 sonucunu, CSV/JSON/XLSX şemasını ve tek Telegram özetini doğrular. Meta yanıtları ve Chrome API'leri kontrollü taklitlerdir; canlı Meta oturumunda test yapılmaz.
