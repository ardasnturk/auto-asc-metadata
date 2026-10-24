# Brief: app_profile’ı tamamla

Dosya: `.vitrin/app_profile.json` (şema: AppProfile). Analyzer deterministik kısmı doldurdu. Sen şunları yap:

1. Kaynak kodu (özellikle ekran/görünüm dosyalarını) oku ve analyzer’ın göremediği **çekirdek özellikleri** `features` listesine ekle:
   `{ "id": "kebab-case", "title": "…", "description": "…", "kind": "core", "evidence": [{ "path": "proje köküne göre yol", "line": 12 }], "confidence": "high", "source": "claude" }`
   Kanıt gerçek bir dosya olmalı; uygulamada olmayan hiçbir özelliği ekleme (App Review 2.3). Pazarlama metni (paywall maddeleri vb.) kanıt değildir, çalışan kod kanıttır.
2. `positioning` alanını doldur: `{ "audience": "…", "jobToBeDone": "…", "tone": "…" }`.
3. `categorySuggestion` gerekirse düzelt (ASC kategori sabiti, ör. HEALTH_AND_FITNESS) ve gerekçesini yaz.
4. `vitrin.config.yaml` içinde `research.seeds` alanına her dil için 4–8 tohum arama terimi yaz (kullanıcının App Store’da gerçekten yazacağı ifadeler; rakip markası değil).
5. `capture.screens` listesini uygulamanın gösterilmeye değer 5–8 ekranıyla doldur (`-VitrinScreen <id>` vb. launch argümanları). Uygulamada `-VitrinDemo` yoksa kullanıcıya eklenecek dosyayı göster (skill/references/troubleshooting.md).

Bekleyen notlar (todo):
- Kategori önerisi zayıf; Claude app_profile.categorySuggestion alanını işleve göre düzeltmeli.
- positioning (hedef kitle, kullanıcının işi, ton) Claude tarafından doldurulmalı.

Mevcut özellikler:

| id | başlık | tür | kanıt |
|---|---|---|---|
| `ipad` | iPad desteği | platform | Ritim.xcodeproj/project.pbxproj |
| `export` | Dışa aktarma | core | Ritim/Support/CSVExport.swift:4, Ritim/Views/StatsView.swift:90 |
| `reminders` | Hatırlatıcı bildirimler | capability | Ritim/Support/ReminderScheduler.swift:11 |
| `sharing` | Paylaşma | core | Ritim/Views/HabitDetailView.swift:52, Ritim/Views/StatsView.swift:80 |
| `search` | Arama | core | Ritim/Views/HomeView.swift:58 |
| `charts` | Grafikler | core | Ritim/Views/StatsView.swift:1 |
| `premium-subscription` | Premium abonelik | monetization | Ritim.storekit |
| `localization` | 2 dil desteği | core | Ritim/Resources/InfoPlist.xcstrings |

Bitince `vitrin analyze` yeniden çalıştırılmaz (eklemelerin korunur); `vitrin research` ile devam et.
