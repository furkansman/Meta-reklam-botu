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

Bu paket **v0.13.0** olarak sürümlenmiştir. `chrome://extensions` üzerinden doğru depo klasöründen yüklenen eklentiyi yenileyin ve açık Meta sekmesini bir kez yeniden yükleyin. Panelin altında v0.13.0 görünmelidir; görünmüyorsa Chrome başka/eski bir klasörü çalıştırıyordur. Worker, eski sayfa betiğini sürüm kontrolüyle saptar ve önceki sonuçları silmeden yenileme ister. Tarama panelindeki aday/kart sayıları güncel betiğin gerçekten hangi kapsayıcıları işlediğini gösterir.

Kart keşfi artık hiçbir sınıf/border seçicisine dayanmaz. `(Kütüphane Kodu|Library ID)\s*:?\s*(\d{10,})` metninin en küçük eşleşen öğesinden yukarı çıkar; aynı ID ile reklam detayları kontrolünü ve Sponsorlu/Sponsored metninin üstündeki reklamveren adını kapsayan ilk öğeyi seçer. Farklı ID içeren üst sonuç listeleri kart olarak kabul edilmez. Aynı ID bir oturumda yalnızca bir kez saklanır. Türkçe/İngilizce başlangıç tarihleri ISO gün olarak çıkarılır; platform etiketleri ve görsel/video türü de kaydedilir. Eksik tarihler uydurulmaz. Aday/kart teşhisinin yanında sayfadaki “Kütüphane Kodu” metni sayısı gösterilir. Bu kontroller sınıfsız ve rastgele sınıflı DOM örnekleriyle doğrulanmıştır; kullanıcının canlı Meta sayfası bu ortamda incelenmemiştir.

## Kurtarma, kayıt güvenliği ve devam

Toplanan veriler 25 yeni reklamlık artımlı paketler halinde `storage.local` içinde ayrı anahtarlara yazılır; önceki büyük dizi her pakette yeniden yazılmaz. Paket kimliği idempotenttir, yeniden iletim aynı veriyi çoğaltmaz. Aktif veri okuma/dışa aktarma gerektiğinde paketler birleştirilir; tarama bitişinde son küçük paket de kaydedilip kalıcı sonuç normalleştirilir. Ani manuel sekme kapanması/yenilemesi son henüz gönderilmemiş en fazla 24 kaydı kaybettirebilir; otomatik yenilemeden önce bütün bekleyen kayıtlar onaylı olarak yazılır. Browser tamamen kapanırsa yalnızca tamamlanmış yerel paketler garanti edilir.

**Devam Et** son kalıcı reklam kümesini ve kaydırma sayısını yükleyerek mevcut Meta sekmesinde devam eder; eski ID'ler atlanır. Meta'nın sanallaştırılmış liste konumu otomatik geri getirilemez: sayfa yenilendiyse daha önce yüklenmiş kartların üzerinden geçilmesi gerekebilir. Maksimum sayı kayıtlı reklam sayısından yüksek olmalıdır. Yeni Taramayı Başlat ayrı ve sıfırdan bir taramadır.

Panel `~1.100 sonuç / results` metninden Meta'nın yaklaşık sayısını okur, benzersiz toplanan sayıdan ayrı gösterir. Bu tahmin kesin hedef veya tüm kayıtların erişilebilirlik garantisi değildir. “Birden fazla versiyonu var / multiple versions” etiketi taşıyan kartların her ayrı DOM gösterimi bir karşılaşma sayılır; aynı DOM öğesinin tekrar kontrolü sayılmaz. Bu değer gerçek versiyon adedinin tahmini değildir ve devam edilen yeni sayfa gösterimleri yeni karşılaşma sayılabilir.

## Tarih imleciyle tarama

`chunk-scan.js` artık sabit tarih pencereleri yerine tarih imlecini yöneten background kuyruğudur. Normal tarama motoru, kart bulma, ayrıştırma ve çıktı üreticileri değişmez. Mod kapalıysa normal tarama aynı yolu izler. Sayfa hafifletme ayarları her yeni turda aynen okunur.

1. Meta'da arama/ülke/medya/platform filtrelerini ve **En yeniler** sıralamasını seç. Popup kendi penceresindeki aktif sekmeyi okur. İlk tur `start_date[max]` olmadan açılır; sonraki turlarda yalnızca bu parametre eklenir/değiştirilir. `start_date[min]` dahil diğer bütün mevcut parametreler ve sıralama korunur. Tarih penceresi seçimi yoktur.
2. **Tarih imleciyle tarama** seçeneğini aç. Varsayılan sınır tur başına 800 **yeni** reklam, bekleme 15–30 saniyedir. Hedef toplam boşsa bitiş koşuluna kadar sürer; doluysa birleşik havuzun toplamını sınırlar. **Başlat** ve **Havuza ekle** mevcut havuzu korur; sıfırlamak için ayrıca **Havuzu temizle** kullanılır. Kaynak normal tarama kayıtları da havuza eklenebilir.
3. Bütün turlar tek bir ayrı normal Chrome penceresinde, öndeki yeni sekmelerde çalışır. Yükleme ve PING hazırlığından sonra ilk 20 kartın tarihi beklenir (en fazla 10 sn). Okunabilen az örnek varsa aynı %75 yeniden eskiye ölçütü uygulanır; tarih yoksa açık nedenle durur. 20 kartta en az 15 sıralama kontrolü yeniden eskiye olmalıdır. Yanlış sıralamada URL otomatik değiştirilmez; **Sıralama 'En yeniler' değil. Sırala menüsünden 'En yeniler'i seç** uyarısı gösterilir.
4. Mevcut motor havuzdaki bilinen kayıtlarla devam ettirilir; yeni kayıtlar ID ile tekilleştirilir. Tur sınırı, hedef toplam veya motorun yükleme sonu turu bitirir. İmleç havuzdaki en eski geçerli başlangıç tarihidir; aynı gün dahil bırakılır. Boş sonuçta yeniden deneme yapılmaz. Yeni reklam yokken imleç son iki turda aynıysa tarama sona erer. Tarih çıkarılamazsa aynı sayfa döndürülmez; açık uyarıyla duraklar.
5. Aynı gün tur sınırı aşılırsa daha önce Meta adresinde **görülmüş** platform parametresi kullanılarak Facebook/Instagram/Messenger/Audience Network turları oluşturulur. Parametre tahmin edilmez. Zaten tek platform seçili kaynak arama genişletilmez. Bölme mümkün değilse veya platform turları o günü aşamazsa **yoğun gün: eksik olabilir** günlüğüyle imleç bir gün geriye alınır. Yaklaşık Meta sayısına veya eksiksiz erişime garanti verilmez.

Ortak havuz en fazla 25 kayıtlık `chunk-pool:<oturum>:<paket>` anahtarlarında saklanır; eski büyük dizi her eklemede yazılmaz. İmleç her başarılı pakette, kuyruk ve tur durumu her adımda kalıcıdır. **Durdur / Devam Et** ve worker yeniden başlaması kaydedilmiş havuzu kullanır. Chrome/pencere kapanırsa kaydedilmiş veriler korunur; kullanıcı Devam Et ile sürdürür. Eski tarih pencereli oturumlar otomatik çalıştırılmaz; havuzları korunur ve **Havuza ekle** ile taşınabilir.

Mevcut motorun 10.000 kayıtlık oturum sınırı korunur. Büyük havuzlarda o imlece uygun bilinen ID'ler mevcut motor kapasitesine kadar aktarılır; havuzun tamamı yöneticide tekilleştirilir. Bu nedenle çok büyük tekrar kümeleri motor turunu yeni reklam sınırından önce bitirebilir. Yoğun gün teşhisi kapsama eksikliğini açıkça bildirir.

Çıktı şeması değişmez: imleç modunda önceki iki ek sütun **Sıra (gösterim sıralaması)** ve **Parça (tarih aralığı)** korunur; ikinci sütun artık `Tur 3 · 2026-10-12` gibi tur etiketini taşır. CSV/JSON 14, Excel 13 sütundur; normal mod sütunları değişmez. Hook/başlık/CTA ve Excel biçimlendirmesi korunur.

Yalnızca sayfa/ağ yükleme hatası otomatik yeniden açılabilir; aynı tur en fazla **iki kez** açılır, üçüncü açılış yoktur. Başarısız sekme önce gerekçesiyle kaydedilir ve 20 sn açık tutulur. Sıralama, giriş/erişim, ayrıştırma ve motor hataları otomatik yeniden denenmez. Kalıcı alarm/30 sn heartbeat worker'ın kuyruğu sürdürmesini sağlar. Telegram göndericisi değişmez; sonunda yalnızca bir tur özeti oluşturulur.

## Yan panel ve olay günlüğü

Popup ayarlar için korunur. **Yan paneli aç** butonunu kullanarak ilerlemeyi pencereye bağlı kalıcı Chrome yan panelinde izle. Normal popup odak değişince kapanabilir; yan panel popup yaşam süresine bağlı değildir. Tarama penceresindeki izleme sekmesi de aynı görünümü sunar. Yan panel her saniye yalnızca tarama durumu, son 100 olay ve sayaçları okur; büyük reklam havuzunu ya da Telegram kimlik bilgilerini yüklemez. Açık/koyu tema ve mevcut REKLAM/SCROLL görünümü korunur.

`chunkEvents` yerel depoda saat, tur etiketi, olay ve sebep içeren en yeni 100 kaydı tutar. Tur başlangıcı, pencere/sekme açılışı, yükleme, PING hazırlığı, sonuç sayısı, tarama başlangıcı, bitiş, bölünerek atlama, hata, teşhis beklemesi, yeniden deneme ve kapanış kaydedilir. Başarısız turlar ayrıca yan panelde listelenir. Rozet benzersiz sayıyı (örn. 2.1k) veya başarısızlıkta kırmızı ! gösterir. Simgedeki ayar popup'ı korunmak için `openPanelOnActionClick:false` kullanılır; yan panel doğrudan butonun kullanıcı tıklamasından açılır.

## Sayfayı hafifletme ve deneysel medya engelleme

Yeni DOM müdahalesi `page-lightener.js`, sekmeye bağlı ağ kuralları `page-lightener-worker.js`, ayarlar/teşhis `page-lightener-ui.js` içindedir. Kart bulma, ID/hook/başlık/CTA/tarih/medya ayrıştırması, `scan-loop.js`, çıktı üreticileri, hafifletme katmanından bağımsız imleç yöneticisi ve rakip modülü kullanılır. `content.js` içinde sadece başlatma, okuma sonucu bildirimi, çıkarılmış kartı izleme, kayıt onayı, kaydırma ölçümü, geri dönüştürülen öğeyi hazırlama ve bitiş çağrıları vardır. İçerik protokol sürümü v0.9.2'dir.

- **Sayfayı hafiflet** varsayılan açıktır. DOM'dan çıkarılmış olmak yeterli değildir: 25 kayıt paketine worker başarı yanıtı verdikten sonra kart hafifletmeye uygun sayılır. Önceki/okunamayan/hatalı kartlar bu onayı almadan değiştirilmez.
- Son 60 işlenen kart ve görünür kartlar korunur. Her 20 yeni onaylı kayıtta eski uygun kartlar toplu işlenir; her kaydırmada tüm DOM yeniden taranmaz. Toplu işlemde bütün yükseklikler yazma işleminden önce ölçülür; kart başına ölç/yaz döngüsüyle yerleşim hesabı tekrarlanmaz. Kartın ölçülen dış yüksekliği `box-sizing:border-box` ve sabit height ile korunur. Img src/srcset, picture kaynakları ve video src/poster kaldırılır; video pause/load çağrılır, video source öğeleri geri yüklemek üzere saklanarak çıkarılır. Kart/metin/ID/düğmeler DOM'da kalır; content-visibility:auto ve contain-intrinsic-size uygulanır.
- İlk üç kaydırma müdahalesiz ölçülür. Sonraki hız düşüşü yalnızca `Hız düştü: X reklam/dk` uyarısıdır; hafifletme kapanmaz. Veri emniyeti: ardışık 10 başarısız okuma, 100 okumalık pencerede herhangi bir hata veya müdahale sonrası en az 50 kayıtta boş medya URL oranının müdahalesiz ölçümden 2 yüzde puanı fazla olması kapanma nedenidir. Kaydedilmiş kartlar tekrar ayrıştırılmaz; medya oranı, önceki müdahalelerin ardından gelen yeni ve başarıyla kaydedilen kartlardan ölçülür. Müdahalesiz referans yoksa medya oranı karşılaştırılmaz.
- Veri emniyeti kapanınca 150 yeni kaydın ardından hafifletme tekrar denenir; üçüncü kapanma o tarama boyunca kalıcıdır. `Emniyeti kapat (test)` yalnızca uyarı üretir. Daha önce hafifletilmiş kartların medyası topluca yeniden indirilmez.
- Kart bazındaki DOM/medya hataları sayılır ve diğer kartlara devam edilir. Aynı öğeye ikinci kez müdahale edilmez. Meta bir öğeyi farklı ID için yeniden kullanırsa eski stiller açılır, eski reklamın kaynakları yeni karta geri yazılmaz. Yeni sıfırdan taramadan önce önceki hafifletmenin kaynakları/stilleri geri yüklenir; havuza yazılan URL'ler değişmez.

**Medya yüklemeyi engelle (deneysel)** ayrı ve varsayılan kapalıdır. `declarativeNetRequest` izni kullanır. Chrome `tabIds` koşulunu kalıcı dynamic rules üzerinde desteklemediği için programatik **session rules** kullanılır: yalnızca tarama sekmesinde, yalnızca fbcdn.net/fbsbx.com ve alt alanlarında image/media/font engellenir. Script/HTML/XHR engellenmez, diğer sekmelere veya pencereye genel kural konmaz. Engelleme indirme isteğini etkiler; DOM'daki kaynak adreslerini değiştirmez. Boş medya URL sayısı teşhiste görünür. Gerçek Chrome/CDN davranışı kontrollü test taklitleriyle garanti edilemez; bu yüzden deneysel seçeneği ayrı değerlendirin.

Kurallar bitiş/durdurma, sekme kapanması, navigasyon/yenileme ve geçersiz kalan oturumlarda temizlenir. Worker yeniden başlayınca yalnızca hâlâ geçerli oturumların kuralları korunur; yetim kurallar kaldırılır. Kural silme hatasında durdurulmuş kayıt ve yeniden temizleme alarmı tutulur; veri kaydı başarısız sayılmaz. Ayarlar `pageLightenerSettings`, son durum `pageLightenerStatus`, son 100 karşılaştırma satırı `pageLightenerLog` içinde yereldir. Bu anahtarlar dışa aktarmalara ve Chrome Sync'e eklenmez. Rakip taramaları bu özellikleri atlayarak mevcut davranışını korur.

Her 50 onaylı reklamda son 50'nin saniyesi ve reklam/dakika ölçülür. Teşhis hafifletilen kart, hata, boş medya URL sayısı ve varsa `performance.memory.usedJSHeapSize` üzerinden yaklaşık **JS bellek** MB gösterir; bu değer tüm video/GPU belleği değildir. Her 200 kayıtta ve otomatik kapatmada açık/kapalı durum ile hız günlüğe yazılır. Popup ve yan panelde ek teşhis/günlük alanı bulunur; mevcut sayaçlar değişmez. İki seçenek de kapalıyken eski 100 kartlık salt çizim hafifletmesi ve tarama yolu aynen kullanılır.

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
node tests/chunk-export.test.cjs
node tests/page-lightener.test.cjs
```

Örnek CSV ve XLSX yapısını ayrıca Python `openpyxl` ile doğrulamak için: `python3 tests/verify-export.py` (önce export testini çalıştırın).

Tarayıcı entegrasyon testi Playwright gerektirir. Geçici bir dizinde kurarak depo bağımlılıklarını değiştirmeden çalıştırabilirsiniz:

```sh
npm install --prefix /tmp/meta-browser-check --no-save playwright
NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/browser.cjs
NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/chunk-browser.cjs
NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/page-lightener-browser.cjs
# Daha büyük karşılaştırma:
LIGHTENER_TEST_ADS=2000 NODE_PATH=/tmp/meta-browser-check/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/page-lightener-browser.cjs
```

`CHROMIUM_PATH` yerine kurulu Chromium yolunu kullanın veya Playwright'ın kendi Chromium'u kuruluysa değişkeni atlayın. Testler yerel örnek HTML ve Chrome API taklidi kullanır; canlı Facebook veya gerçek Chrome eklenti yüklemesini doğrulamaz. Worker testleri eşzamanlı başlangıçları, yeniden başlatmayı, mesaj kaynaklarını, sekme kaybını, kota hatasını, rakip karşılaştırmasını, arşivleri, Telegram kimlik bilgisi gizliliğini, başarılı/hatalı API yanıtlarını ve yeniden deneme kuyruğunu kapsar. Tarayıcı testi üç betiği birlikte çalıştırarak veri çıkarma, paneli yeniden açma, durdurma, geçmiş, rakip listesi, filtreler arşiv indirmeleri, Telegram formu/test/tamamlanma mesajları ve CSV/JSON içeriğini kontrol eder.

## Sınırlar

DOM çıkarımı yalnızca en az 10 haneli Kütüphane Kodu/Library ID, detaylar kontrolü ve reklamveren/sponsor başlığı birlikte bulunduğunda kart üretir. Yeni taramalarda parmak iziyle kimliksiz reklam üretilmez. Önceki sürümlerin arşivleri korunur. Meta etiketleri veya dil desteği değişirse uyarlama gerekebilir. Gizli, henüz yüklenmemiş veya erişim gerektiren reklamlar toplanmaz. Metinler yalnızca yüklenmiş kapsamlarıyla alınır. Medya bağlantıları geçici olabilir; reklamveren, platform veya medya bulunamazsa eksik bırakılır. Platformu bilinmeyen kayıtlar yalnızca Tüm platformlar seçeneğine dahil edilir; filtreler eksik medyayı tahmin etmez. CSV metinleri elektronik tablo formüllerinin çalışmasını engellemek için kaçışlanır.

Sonuçlar Chrome'un yerel depolama kotasına tabidir. Bir yazım başarısız olursa tarama durur ve son başarılı kayıt korunur. Canlı Meta sayfası ve gerçek eklenti yüklemesi bu ortamda doğrulanmadı. Kullanım için kendi tarayıcınızda paketlenmemiş eklentiyle kontrol edin.

İmleç testleri URL/sıralama korumasını, ilk tarihsiz turu, maksimum tarih eklemeyi/değiştirmeyi, imleç minimumunu, 15/20 sıralama eşiğini, aynı gün/platform sınırını, boş/okunamayan sonuç ayrımını, boş sonuçta yeniden açmama ve ağ hatasında iki açılış sınırını, 20 saniyelik teşhis süresini, kalıcı havuzu/devamı, kota hatasını ve eski havuz taşımasını doğrular. Chromium testi değiştirilmemiş içerik motoruyla üç turda 3 benzersiz reklam toplar; popup/worker yeniden başlangıcını, imlecin ilerlemesini, tekrarları, mevcut sayaçları, CSV/JSON/XLSX şemasını ve tek Telegram özetini kontrol eder. Meta yanıtları ve Chrome API'leri kontrollü taklitlerdir; canlı Meta oturumunda test yapılmaz.

Yaşam döngüsü testleri 20 saniyelik hata beklemesini, kalıcı iki açılış sınırını, 0/okunamadı ayrımını, 10–25 saniyelik probu, PING yeniden deneme/enjeksiyonunu, pencere kullanımını, worker bağlanmasını, son 100 olayı ve rozet biçimini kapsar. Chromium testi popup kapandıktan sonra yan panel sayfasının güncellenmesini ve ayar butonunun sidePanel.open çağrısını doğrular. Yerel Chrome API taklitleri gerçek Chrome yan panelinin pencere/fokus davranışını veya canlı Meta oturumunu doğrulamaz.

Hafifletme testleri okunmamış/görünür kartları, son 60 kartı, ölçülen yüksekliği, medya hatalarını, kaynak geri yüklemeyi, düşük hızda uyarıyı, veri emniyetini, 150 kayıt sonra yeniden denemeyi, üçüncü kapanmayı ve test geçersiz kılmasını ve sekmeye bağlı DNR kural temizliğini doğrular. Chromium A/B testi kapalı, açık ve deneysel engelleme açık durumlarında ID, reklamveren, tam metin/hook, başlık, CTA, tarih, medya türü/URL, hedef ve platformları birebir karşılaştırır. Ağ engelleme ve Chrome mesaj API’leri taklittir; DOM ve medya etiketleri gerçek Chromium’da çalışır. Canlı Meta oturumu veya gerçek Chrome DNR politikası bu ortamda doğrulanmaz.
