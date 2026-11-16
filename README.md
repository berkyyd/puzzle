# parça parça

Arkadaşlarla gerçek zamanlı puzzle oyunu. Oda koduyla veya davet bağlantısıyla katılın; oda sahibi görseli ve parça sayısını seçip oyunu başlatır.

## Çalıştırma

Node.js 18 veya üzeri gerekir.

```sh
npm install
npm start
```

Site `http://localhost:3000` adresinde açılır. Başka cihazlardan internet üzerinden katılım için uygulamayı WebSocket destekli, HTTPS kullanan bir Node.js sunucusunda yayınlayın; kamera ve mikrofon izinleri uzaktaki kullanıcılar için güvenli bağlantı gerektirir. Oda durumu sunucu belleğinde tutulur ve sunucu yeniden başlayınca odalar sıfırlanır.

## Özellikler

- 12, 50, 100, 250, 500 veya 1000 parça
- Sabit, dengeli ızgaralar: 4×3, 10×5, 10×10, 25×10, 20×25 ve 40×25
- Birbirine uyan girintili-çıkıntılı puzzle parçası şekilleri
- Görsel oranına göre otomatik sığan, kopya görsel veya silik parça kılavuzu göstermeyen çalışma tuvali
- Çalışma alanında küçük tam-görsel önizlemesi ve puzzle tamamlandığında duran süre
- Taşıyan oyuncunun baş harfi, yerleşen parçaların alt katmanda kalması ve süreli bitiş kutlaması
- Oyun ekranından ana sayfaya dönüş; bitiş kutlamasını kapatıp tamamlanmış puzzle'ı görüntüleme
- Puzzle tamamlanınca şekilli parça kenarlarını gösteren, süre ve site adı içeren anı kartını PNG olarak indirme
- Oyun sırasında isteğe bağlı kamera ve mikrofon: varsayılan kapalı, her oyuncu tarayıcı iznini ayrı ayrı verir; görüntü ve ses eşler arasında WebRTC ile aktarılır
- Hazır görseller ve JPG/PNG/WebP görsel yükleme
- Oda kodu ve paylaşılabilir davet bağlantısı
- Gerçek zamanlı oyuncu listesi, parça hareketi, kilitler, süre ve sohbet
- Dokunmatik ekranlarda parça sürükleme
