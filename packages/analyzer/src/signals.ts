import type { Evidence } from '@vitrin/schemas';

/**
 * Code signals detected in Swift sources. Each rule may produce a feature (with the matching line as evidence)
 * and/or a raw signal used for the accessibility and age-rating drafts.
 */
export interface SignalRule {
  id: string;
  pattern: RegExp;
  feature?: { id: string; title: string; kind: 'core' | 'capability' | 'integration' | 'monetization' | 'platform'; description: string };
  signal?: string;
  category?: string;
}

export const SIGNAL_RULES: SignalRule[] = [
  { id: 'healthkit', pattern: /\bimport\s+HealthKit\b|HKHealthStore\(/, feature: { id: 'apple-health', title: 'Apple Health entegrasyonu', kind: 'integration', description: 'HealthKit ile sağlık verisi okur/yazar.' }, category: 'HEALTH_AND_FITNESS' },
  { id: 'cloudkit', pattern: /\bimport\s+CloudKit\b|NSPersistentCloudKitContainer|cloudKitDatabase\s*:/, feature: { id: 'icloud-sync', title: 'iCloud senkronizasyonu', kind: 'capability', description: 'Veriler iCloud ile cihazlar arasında eşitlenir.' } },
  { id: 'swiftdata', pattern: /\bimport\s+SwiftData\b/, signal: 'storage.swiftdata' },
  { id: 'widgetkit', pattern: /\bimport\s+WidgetKit\b/, signal: 'platform.widgetkit' },
  { id: 'activitykit', pattern: /\bimport\s+ActivityKit\b/, feature: { id: 'live-activities', title: 'Canlı Etkinlikler', kind: 'platform', description: 'Kilit ekranında ve Dynamic Island’da canlı etkinlik gösterir.' } },
  { id: 'storekit', pattern: /\bimport\s+StoreKit\b/, signal: 'monetization.storekit' },
  { id: 'charts', pattern: /\bimport\s+Charts\b/, feature: { id: 'charts', title: 'Grafikler', kind: 'core', description: 'Verileri grafiklerle görselleştirir.' } },
  { id: 'mapkit', pattern: /\bimport\s+MapKit\b/, feature: { id: 'maps', title: 'Harita', kind: 'core', description: 'Konumları harita üzerinde gösterir.' }, category: 'NAVIGATION' },
  { id: 'weatherkit', pattern: /\bimport\s+WeatherKit\b/, feature: { id: 'weather-data', title: 'Hava durumu verisi', kind: 'integration', description: 'WeatherKit ile hava durumu verisi kullanır.' }, category: 'WEATHER' },
  { id: 'local-auth', pattern: /\bimport\s+LocalAuthentication\b/, feature: { id: 'biometric-lock', title: 'Face ID ile kilit', kind: 'capability', description: 'Uygulamayı Face ID/Touch ID ile kilitler.' } },
  { id: 'foundation-models', pattern: /\bimport\s+FoundationModels\b/, feature: { id: 'on-device-ai', title: 'Cihaz üstü yapay zekâ', kind: 'capability', description: 'Apple’ın cihaz üstü dil modelini kullanır.' } },
  { id: 'coreml', pattern: /\bimport\s+(CoreML|CreateML)\b/, signal: 'ml.coreml' },
  { id: 'vision', pattern: /\bimport\s+Vision\b/, signal: 'ml.vision' },
  { id: 'photos', pattern: /\bimport\s+PhotosUI\b|PhotosPicker\(/, signal: 'media.photos', category: 'PHOTO_AND_VIDEO' },
  { id: 'avfoundation', pattern: /\bimport\s+AVFoundation\b|AVAudioPlayer|AVPlayer\(/, signal: 'media.av' },
  { id: 'notifications', pattern: /UNUserNotificationCenter|UNMutableNotificationContent/, feature: { id: 'reminders', title: 'Hatırlatıcı bildirimler', kind: 'capability', description: 'Yerel bildirimlerle hatırlatma gönderir.' } },
  { id: 'gamekit', pattern: /\bimport\s+GameKit\b/, feature: { id: 'game-center', title: 'Game Center', kind: 'integration', description: 'Liderlik tablosu ve başarımlar.' }, category: 'GAMES' },
  { id: 'tipkit', pattern: /\bimport\s+TipKit\b/, signal: 'ux.tipkit' },
  { id: 'share', pattern: /ShareLink\(|UIActivityViewController/, feature: { id: 'sharing', title: 'Paylaşma', kind: 'core', description: 'İçeriği paylaşma sayfasıyla paylaşır.' } },
  { id: 'export', pattern: /\.fileExporter\(|UIDocumentPickerViewController|\bCSV\b/, feature: { id: 'export', title: 'Dışa aktarma', kind: 'core', description: 'Verileri dosya olarak dışa aktarır.' } },
  { id: 'search', pattern: /\.searchable\(/, feature: { id: 'search', title: 'Arama', kind: 'core', description: 'Uygulama içi arama.' } },
  { id: 'translation', pattern: /\bimport\s+Translation\b/, signal: 'ml.translation' },
  { id: 'network', pattern: /URLSession\.|URLRequest\(|\bAlamofire\b|WebSocket/, signal: 'network.remote' },
  { id: 'analytics', pattern: /\b(Firebase|Amplitude|Mixpanel|Segment|TelemetryDeck|PostHog)\b/, signal: 'privacy.analytics-sdk' },
  { id: 'ads', pattern: /\b(GoogleMobileAds|GADBannerView|AppLovin|IronSource|UnityAds)\b/, signal: 'monetization.ads' },
  { id: 'webview', pattern: /\bWKWebView\b|SFSafariViewController/, signal: 'age.unrestricted-web' },
  { id: 'ugc', pattern: /\b(comment|chat|message|post|follow|friend)s?(View|Service|Store|Model)\b/, signal: 'age.user-generated-content' },
  { id: 'social', pattern: /\b(Followers?|Feed|DirectMessage|ChatRoom)\b/, signal: 'age.social-features' },
  // Accessibility (drafts for the Accessibility Nutrition Labels)
  { id: 'a11y-label', pattern: /\.accessibilityLabel\(|\.accessibilityHint\(|\.accessibilityElement\(/, signal: 'accessibility.voiceover' },
  { id: 'a11y-dynamic-type', pattern: /@ScaledMetric|\.dynamicTypeSize\(|\.font\(\.(body|headline|title|caption|footnote|subheadline|callout|largeTitle)/, signal: 'accessibility.larger-text' },
  { id: 'a11y-reduce-motion', pattern: /accessibilityReduceMotion|UIAccessibility\.isReduceMotionEnabled/, signal: 'accessibility.reduced-motion' },
  { id: 'a11y-contrast', pattern: /colorSchemeContrast|accessibilityDifferentiateWithoutColor|UIAccessibility\.isDarkerSystemColorsEnabled/, signal: 'accessibility.sufficient-contrast' },
  { id: 'a11y-dark', pattern: /\.preferredColorScheme\(|colorScheme\s*==\s*\.dark|@Environment\(\\\.colorScheme\)/, signal: 'accessibility.dark-interface' },
  { id: 'a11y-voice-control', pattern: /\.accessibilityInputLabels\(/, signal: 'accessibility.voice-control' },
  { id: 'a11y-captions', pattern: /AVPlayerItem.*legible|closedCaption|\.vtt\b/, signal: 'accessibility.captions' },
  { id: 'demo-mode', pattern: /VitrinDemo/, signal: 'vitrin.demo-mode' },
];

export interface SignalHit {
  rule: SignalRule;
  evidence: Evidence;
}

export function scanSource(relPath: string, text: string): SignalHit[] {
  const hits: SignalHit[] = [];
  const lines = text.split('\n');
  for (const rule of SIGNAL_RULES) {
    for (let ln = 0; ln < lines.length; ln++) {
      if (rule.pattern.test(lines[ln]!)) {
        hits.push({ rule, evidence: { path: relPath, line: ln + 1, note: lines[ln]!.trim().slice(0, 120) } });
        break; // first hit per file is enough
      }
    }
  }
  return hits;
}
